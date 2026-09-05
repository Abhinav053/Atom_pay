const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { getPgPool, getRedis, connectMongoDB } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "dev-payment-webhook-secret";

// MongoDB Webhook Audit Schema
const WebhookEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true },
    paymentId: { type: String, required: true },
    provider: { type: String, default: "MOCK_GATEWAY" },
    eventType: { type: String, required: true },
    payload: { type: Object, required: true },
    receivedAt: { type: Date, default: Date.now }
});

let WebhookEvent;
try {
    WebhookEvent = mongoose.model("WebhookEvent");
} catch {
    WebhookEvent = mongoose.model("WebhookEvent", WebhookEventSchema);
}

function verifySignature(payload, signature) {
    if (!signature) return false;
    const expected = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(JSON.stringify(payload))
        .digest("hex");
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

app.post(["/", "/payment"], async (req, res) => {
    try {
        const signature = req.headers["x-payment-signature"];
        if (!verifySignature(req.body, signature)) {
            return res.status(401).json({ msg: "Invalid payment webhook signature" });
        }

        const { paymentId, userId, amount, status, gatewayTxnId, failureReason, provider } = req.body;
        if (!paymentId || !userId || !gatewayTxnId || !["SUCCESS", "FAILED"].includes(status)) {
            return res.status(400).json({ msg: "Invalid payment webhook payload" });
        }

        // Deduplication Check in Redis
        const redis = getRedis();
        const dedupeKey = `idem:payment-webhook:${paymentId}:${gatewayTxnId}`;
        const reserved = await redis.set(dedupeKey, "1", "NX", "EX", 86400);
        if (!reserved) {
            return res.status(200).json({ duplicate: true, message: "Webhook already processed" });
        }

        // Log Raw Webhook Payload in MongoDB
        try {
            await connectMongoDB();
            await WebhookEvent.create({
                eventId: `evt_${crypto.randomUUID()}`,
                paymentId,
                provider: provider || "MOCK_GATEWAY",
                eventType: `payment.${status.toLowerCase()}`,
                payload: req.body
            });
        } catch (mongoErr) {
            logger.error("Failed to log raw webhook event to MongoDB", { error: mongoErr.message });
        }

        // Process Financial Update in PostgreSQL
        const pool = getPgPool();
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Lock & fetch payment record
            const payRes = await client.query("SELECT * FROM payments WHERE payment_id = $1 FOR UPDATE", [paymentId]);
            if (payRes.rows.length === 0) {
                await client.query("ROLLBACK");
                await redis.del(dedupeKey);
                return res.status(404).json({ msg: "Payment not found" });
            }

            const payment = payRes.rows[0];
            if (payment.status === "SUCCESS" || payment.status === "FAILED") {
                await client.query("COMMIT");
                return res.status(200).json({ duplicate: true, message: "Payment already in terminal state" });
            }

            // Update payment state
            await client.query(
                `UPDATE payments 
                 SET status = $1, gateway_txn_id = $2, failure_reason = $3, updated_at = CURRENT_TIMESTAMP 
                 WHERE payment_id = $4`,
                [status, gatewayTxnId, failureReason || null, paymentId]
            );

            // Record payment attempt update
            await client.query(
                `INSERT INTO payment_attempts (payment_id, attempt_number, provider, provider_payment_id, status, error_message)
                 VALUES ($1, 2, $2, $3, $4, $5)`,
                [paymentId, provider || "MOCK_GATEWAY", gatewayTxnId, status, failureReason || null]
            );

            if (status === "SUCCESS") {
                // Lock & fetch wallet
                const walletRes = await client.query("SELECT id, balance, status FROM wallets WHERE user_id = $1 FOR UPDATE", [userId]);
                if (walletRes.rows.length === 0) {
                    await client.query("ROLLBACK");
                    await redis.del(dedupeKey);
                    return res.status(404).json({ msg: "Wallet not found" });
                }
                const wallet = walletRes.rows[0];
                if (wallet.status !== "Active") {
                    await client.query("ROLLBACK");
                    await redis.del(dedupeKey);
                    return res.status(400).json({ msg: "Wallet is not active" });
                }

                // Credit balance
                await client.query(
                    "UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                    [amount, wallet.id]
                );

                // Create top-up transaction record
                const txnId = crypto.randomUUID();
                await client.query(
                    `INSERT INTO wallet_transactions 
                     (transaction_id, type, to_wallet_id, amount, status, note, receiver_username, payment_id, gateway_txn_id)
                     VALUES ($1, 'topup', $2, $3, 'success', $4, 'wallet-topup', $5, $6)`,
                    [txnId, wallet.id, amount, `Wallet top-up via ${payment.provider}`, paymentId, gatewayTxnId]
                );

                // Record in double-entry ledger
                const clearingAccRes = await client.query("SELECT id FROM ledger_accounts WHERE account_number = 'ACC_SYSTEM_CLEARING'");
                const userAccRes = await client.query("SELECT id FROM ledger_accounts WHERE user_id = $1", [userId]);

                let clearingAccId, userAccId;
                if (clearingAccRes.rows.length === 0) {
                    const newClearing = await client.query(
                        "INSERT INTO ledger_accounts (account_number, account_type) VALUES ('ACC_SYSTEM_CLEARING', 'SYSTEM_CLEARING') RETURNING id"
                    );
                    clearingAccId = newClearing.rows[0].id;
                } else {
                    clearingAccId = clearingAccRes.rows[0].id;
                }

                if (userAccRes.rows.length > 0) {
                    userAccId = userAccRes.rows[0].id;
                    await client.query(
                        `INSERT INTO ledger_entries (entry_id, transaction_type, debit_account_id, credit_account_id, amount, reference_id, description)
                         VALUES ($1, 'TOPUP', $2, $3, $4, $5, 'Wallet top-up')`,
                        [crypto.randomUUID(), clearingAccId, userAccId, amount, paymentId]
                    );
                }

                // Create Outbox Event
                const outboxPayload = {
                    eventId: crypto.randomUUID(),
                    eventType: EVENT_TYPES.PAYMENT_SUCCEEDED,
                    aggregateType: "payment",
                    aggregateId: paymentId,
                    payload: { paymentId, userId, amount, gatewayTxnId }
                };
                await client.query(
                    `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                     VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                    [outboxPayload.eventId, outboxPayload.eventType, outboxPayload.aggregateType, outboxPayload.aggregateId, JSON.stringify(outboxPayload.payload)]
                );
            }

            await client.query("COMMIT");

            // Clear cache
            await redis.del(`cache:balance:${userId}`, `cache:txns:${userId}`);

            logger.info("Payment webhook processed successfully", { paymentId, status });
            return res.status(200).json({ duplicate: false, message: "Payment webhook processed" });
        } catch (dbErr) {
            await client.query("ROLLBACK");
            await redis.del(dedupeKey);
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (err) {
        logger.error("Payment webhook error", { error: err.message });
        return res.status(500).json({ msg: "Internal server error" });
    }
});

const PORT = process.env.PORT || 3005;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Webhook Service running on port ${PORT}`);
    });
}

module.exports = app;
