const crypto = require("crypto");
const { getPgPool, getRedis } = require("../database");
const logger = require("../logger");
const { EVENT_TYPES } = require("../shared-events");

async function finalizePayment({
    pool = getPgPool(),
    redis = getRedis(),
    paymentId,
    status,
    gatewayTxnId,
    failureReason = null,
    provider = "MOCK_GATEWAY",
    source = "WEBHOOK"
}) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Lock payment row
        const payRes = await client.query("SELECT * FROM payments WHERE payment_id = $1 FOR UPDATE", [paymentId]);
        if (payRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return { status: "NOT_FOUND", duplicate: false };
        }

        const payment = payRes.rows[0];
        const userId = payment.user_id;
        const amount = parseFloat(payment.amount);

        // 2. Check terminal state idempotency
        if (payment.status === "SUCCESS" || payment.status === "FAILED") {
            await client.query("COMMIT");
            return { status: payment.status, duplicate: true };
        }

        // 3. Update payment status
        await client.query(
            `UPDATE payments 
             SET status = $1, gateway_txn_id = $2, failure_reason = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE payment_id = $4`,
            [status, gatewayTxnId || payment.gateway_txn_id, failureReason || null, paymentId]
        );

        // 4. Record payment attempt
        await client.query(
            `INSERT INTO payment_attempts (payment_id, attempt_number, provider, provider_payment_id, status, error_message)
             VALUES ($1, 2, $2, $3, $4, $5)`,
            [paymentId, provider || payment.provider || "MOCK_GATEWAY", gatewayTxnId || payment.gateway_txn_id, status, failureReason || null]
        );

        // 5. Handle SUCCESS financial side-effects
        if (status === "SUCCESS") {
            // Lock wallet row
            const walletRes = await client.query("SELECT id, balance, status FROM wallets WHERE user_id = $1 FOR UPDATE", [userId]);
            if (walletRes.rows.length === 0) {
                await client.query("ROLLBACK");
                return { status: "WALLET_NOT_FOUND", duplicate: false };
            }

            const wallet = walletRes.rows[0];
            if (wallet.status !== "Active") {
                await client.query("ROLLBACK");
                return { status: "WALLET_INACTIVE", duplicate: false };
            }

            // Credit wallet balance
            await client.query(
                "UPDATE wallets SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                [amount, wallet.id]
            );

            // Insert wallet transaction record
            const txnId = crypto.randomUUID();
            await client.query(
                `INSERT INTO wallet_transactions 
                 (transaction_id, type, to_wallet_id, amount, status, note, receiver_username, payment_id, gateway_txn_id)
                 VALUES ($1, 'topup', $2, $3, 'success', $4, 'wallet-topup', $5, $6)`,
                [txnId, wallet.id, amount, `Wallet top-up via ${payment.provider || provider}`, paymentId, gatewayTxnId || payment.gateway_txn_id]
            );

            // Double-entry accounting ledger entries
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

            // Create PAYMENT_SUCCEEDED outbox event
            const outboxPayload = {
                eventId: crypto.randomUUID(),
                eventType: EVENT_TYPES.PAYMENT_SUCCEEDED,
                aggregateType: "payment",
                aggregateId: paymentId,
                payload: { paymentId, userId, amount, gatewayTxnId: gatewayTxnId || payment.gateway_txn_id }
            };
            await client.query(
                `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                [outboxPayload.eventId, outboxPayload.eventType, outboxPayload.aggregateType, outboxPayload.aggregateId, JSON.stringify(outboxPayload.payload)]
            );
        } else if (status === "FAILED") {
            // Create PAYMENT_FAILED outbox event
            const outboxPayload = {
                eventId: crypto.randomUUID(),
                eventType: EVENT_TYPES.PAYMENT_FAILED,
                aggregateType: "payment",
                aggregateId: paymentId,
                payload: { paymentId, userId, amount, provider: provider || payment.provider || "MOCK_GATEWAY", failureReason }
            };
            await client.query(
                `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                [outboxPayload.eventId, outboxPayload.eventType, outboxPayload.aggregateType, outboxPayload.aggregateId, JSON.stringify(outboxPayload.payload)]
            );
        }

        await client.query("COMMIT");

        // Clear balance & txns cache
        if (redis) {
            await redis.del(`cache:balance:${userId}`, `cache:txns:${userId}`);
        }

        logger.info(`Payment finalized successfully via ${source}`, { paymentId, status, userId, amount });
        return { status, duplicate: false, userId, amount };
    } catch (err) {
        await client.query("ROLLBACK");
        logger.error(`Error finalizing payment via ${source}`, { paymentId, error: err.message });
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { finalizePayment };
