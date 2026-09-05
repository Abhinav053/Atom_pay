const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getPgPool, getRedis } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");

const app = express();
app.use(express.json());

const BALANCE_TTL = 60;
const TXNS_TTL = 30;

// GET /wallet or /wallet/me or /wallet/balance
app.get(["/", "/me", "/balance"], async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const redis = getRedis();
        const cacheKey = `cache:balance:${userId}`;
        const cached = await redis.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const pool = getPgPool();
        const result = await pool.query(
            "SELECT balance, currency, status, qr_code FROM wallets WHERE user_id = $1",
            [userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: "Wallet not found" });
        }

        const wallet = result.rows[0];
        const payload = {
            balance: parseFloat(wallet.balance),
            currency: wallet.currency,
            status: wallet.status,
            qrCode: wallet.qr_code
        };

        await redis.set(cacheKey, JSON.stringify(payload), "EX", BALANCE_TTL);
        return res.json(payload);
    } catch (err) {
        logger.error("Get wallet error", { error: err.message });
        return res.status(500).json({ msg: err.message });
    }
});

// GET /wallet/transactions
app.get("/transactions", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const redis = getRedis();
        const cacheKey = `cache:txns:${userId}`;
        const cached = await redis.get(cacheKey);
        if (cached) return res.json(JSON.parse(cached));

        const pool = getPgPool();
        const walletRes = await pool.query("SELECT id FROM wallets WHERE user_id = $1", [userId]);
        if (walletRes.rows.length === 0) {
            return res.status(404).json({ msg: "Wallet not found" });
        }
        const walletId = walletRes.rows[0].id;

        const txRes = await pool.query(
            `SELECT * FROM wallet_transactions 
             WHERE from_wallet_id = $1 OR to_wallet_id = $1 
             ORDER BY created_at DESC LIMIT 50`,
            [walletId]
        );

        const payload = txRes.rows.map(tx => {
            const isTopup = tx.type === "topup";
            const isDebit = !isTopup && tx.from_wallet_id === walletId;
            return {
                transactionId: tx.transaction_id,
                amount: parseFloat(tx.amount),
                status: tx.status,
                type: isTopup ? "topup" : (isDebit ? "debit" : "credit"),
                note: tx.note || null,
                senderUsername: tx.sender_username || null,
                receiverUsername: tx.receiver_username || null,
                peerUsername: isTopup ? "MOCK_GATEWAY" : (isDebit ? tx.receiver_username : tx.sender_username),
                paymentId: tx.payment_id || null,
                gatewayTxnId: tx.gateway_txn_id || null,
                createdAt: tx.created_at
            };
        });

        await redis.set(cacheKey, JSON.stringify(payload), "EX", TXNS_TTL);
        return res.json(payload);
    } catch (err) {
        logger.error("Get transactions error", { error: err.message });
        return res.status(500).json({ msg: "Something went wrong" });
    }
});

// POST /wallet/transfer
app.post("/transfer", async (req, res) => {
    const senderId = req.headers["x-user-id"];
    if (!senderId) return res.status(401).json({ msg: "Unauthorized" });

    const { receiverUsername, amount, pin, note } = req.body;
    const idempotencyKey = req.headers["idempotency-key"];

    if (!amount || amount < 1) {
        return res.status(400).json({ msg: "please send a valid amount" });
    }
    if (!idempotencyKey) {
        return res.status(400).json({ msg: "Idempotency-Key header is required" });
    }

    const pool = getPgPool();
    const redis = getRedis();

    try {
        // Fetch sender
        const senderRes = await pool.query(
            "SELECT id, username, hashed_pin, active FROM users WHERE id = $1",
            [senderId]
        );
        if (senderRes.rows.length === 0) return res.status(400).json({ msg: "Invalid sender" });
        const sender = senderRes.rows[0];
        if (!sender.active) return res.status(400).json({ msg: "You can not send money because you are not active" });

        // Verify PIN
        const isMatch = await bcrypt.compare(pin, sender.hashed_pin);
        if (!isMatch) return res.status(400).json({ msg: "You entered wrong pin" });

        // Fetch receiver
        const receiverRes = await pool.query(
            "SELECT id, username, active FROM users WHERE username = $1",
            [receiverUsername]
        );
        if (receiverRes.rows.length === 0) return res.status(400).json({ msg: "Invalid receiver" });
        const receiver = receiverRes.rows[0];
        if (sender.id === receiver.id) return res.status(400).json({ msg: "You are sending money to yourself" });
        if (!receiver.active) return res.status(400).json({ msg: "You can not send money because receiver is inactive" });

        // Check velocity limit (₹1,00,000 / 24h)
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const velocityRes = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as total_sent FROM wallet_transactions wt
             JOIN wallets w ON wt.from_wallet_id = w.id
             WHERE w.user_id = $1 AND wt.status = 'success' AND wt.created_at >= $2`,
            [senderId, since]
        );
        const totalSent = parseFloat(velocityRes.rows[0].total_sent);
        if (totalSent + amount > 100000) {
            logger.warn("Velocity cap reached", { username: sender.username, totalSent, amount });
            return res.status(400).json({ msg: "You cannot send more than ₹1,00,000 in 24 hours" });
        }

        // Execute Transaction with PostgreSQL Row Locking
        const client = await pool.connect();
        const transactionId = crypto.randomUUID();

        try {
            await client.query("BEGIN");

            // Lock wallets in deterministic order (by user_id) to prevent deadlocks
            const ids = [senderId, receiver.id].sort();
            const walletsRes = await client.query(
                `SELECT id, user_id, balance, status FROM wallets WHERE user_id IN ($1, $2) FOR UPDATE`,
                ids
            );

            const senderWallet = walletsRes.rows.find(w => w.user_id === senderId);
            const receiverWallet = walletsRes.rows.find(w => w.user_id === receiver.id);

            if (!senderWallet) {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: "Sender wallet does not exist" });
            }
            if (senderWallet.status !== "Active") {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: "Your wallet is either frozen or closed" });
            }
            if (!receiverWallet) {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: "Receiver does not have a wallet" });
            }
            if (receiverWallet.status !== "Active") {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: "Receiver's wallet is either closed or frozen" });
            }

            // Revalidate balance inside locked transaction
            if (parseFloat(senderWallet.balance) < amount) {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: "You don't have sufficient money" });
            }

            // Perform balances update
            await client.query(
                "UPDATE wallets SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [amount, senderWallet.id]
            );
            await client.query(
                "UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [amount, receiverWallet.id]
            );

            // Record transaction
            await client.query(
                `INSERT INTO wallet_transactions 
                 (transaction_id, idempotency_key, type, from_wallet_id, to_wallet_id, amount, status, note, sender_username, receiver_username)
                 VALUES ($1, $2, 'transfer', $3, $4, $5, 'success', $6, $7, $8)`,
                [transactionId, idempotencyKey, senderWallet.id, receiverWallet.id, amount, note || null, sender.username, receiver.username]
            );

            // Double-entry accounting: Record in ledger_entries
            const senderAccRes = await client.query("SELECT id FROM ledger_accounts WHERE user_id = $1", [senderId]);
            const receiverAccRes = await client.query("SELECT id FROM ledger_accounts WHERE user_id = $1", [receiver.id]);
            if (senderAccRes.rows.length > 0 && receiverAccRes.rows.length > 0) {
                await client.query(
                    `INSERT INTO ledger_entries (entry_id, transaction_type, debit_account_id, credit_account_id, amount, reference_id, description)
                     VALUES ($1, 'TRANSFER', $2, $3, $4, $5, $6)`,
                    [crypto.randomUUID(), senderAccRes.rows[0].id, receiverAccRes.rows[0].id, amount, transactionId, `Transfer from @${sender.username} to @${receiver.username}`]
                );
            }

            // Transactional Outbox Event
            const eventPayload = {
                eventId: crypto.randomUUID(),
                eventType: EVENT_TYPES.TRANSFER_SUCCEEDED,
                aggregateType: "transfer",
                aggregateId: transactionId,
                payload: {
                    transactionId,
                    senderId,
                    receiverId: receiver.id,
                    senderUsername: sender.username,
                    receiverUsername: receiver.username,
                    amount
                }
            };
            await client.query(
                `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                [eventPayload.eventId, eventPayload.eventType, eventPayload.aggregateType, eventPayload.aggregateId, JSON.stringify(eventPayload.payload)]
            );

            await client.query("COMMIT");
        } catch (txnErr) {
            await client.query("ROLLBACK");
            throw txnErr;
        } finally {
            client.release();
        }

        // Cache Invalidation
        await redis.del(
            `cache:balance:${senderId}`,
            `cache:balance:${receiver.id}`,
            `cache:txns:${senderId}`,
            `cache:txns:${receiver.id}`
        );

        logger.info("Transfer succeeded", { transactionId, sender: sender.username, receiver: receiver.username, amount });
        return res.status(200).json({ msg: "Money sent successfully", transactionId });
    } catch (err) {
        logger.error("Transfer money error", { error: err.message });
        return res.status(500).json({ msg: "Transaction failed. Please try again." });
    }
});

const PORT = process.env.PORT || 3002;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Wallet Service running on port ${PORT}`);
    });
}

module.exports = app;
