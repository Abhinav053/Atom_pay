const { getPgPool, getRedis } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");
const crypto = require("crypto");

async function reconcileUnresolvedPayments() {
    const pool = getPgPool();
    const redis = getRedis();
    const threshold = new Date(Date.now() - 30 * 1000); // 30 seconds ago

    try {
        const result = await pool.query(
            `SELECT * FROM payments 
             WHERE status = 'UNKNOWN' OR (status = 'PROCESSING' AND updated_at <= $1)
             ORDER BY updated_at ASC LIMIT 50`,
            [threshold]
        );

        for (const payment of result.rows) {
            logger.info("Reconciling payment", { paymentId: payment.payment_id, currentStatus: payment.status });

            // Simulate Provider Status API call
            const providerStatus = Math.random() < 0.8 ? "SUCCESS" : "FAILED";
            const gatewayTxnId = payment.gateway_txn_id || `recon_${crypto.randomUUID()}`;

            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                await client.query(
                    `UPDATE payments 
                     SET status = $1, gateway_txn_id = $2, updated_at = CURRENT_TIMESTAMP 
                     WHERE payment_id = $3`,
                    [providerStatus, gatewayTxnId, payment.payment_id]
                );

                if (providerStatus === "SUCCESS") {
                    // Credit Wallet
                    const walletRes = await client.query("SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE", [payment.user_id]);
                    if (walletRes.rows.length > 0) {
                        const walletId = walletRes.rows[0].id;
                        await client.query("UPDATE wallets SET balance = balance + $1 WHERE id = $2", [payment.amount, walletId]);
                        await client.query(
                            `INSERT INTO wallet_transactions 
                             (transaction_id, type, to_wallet_id, amount, status, note, receiver_username, payment_id, gateway_txn_id)
                             VALUES ($1, 'topup', $2, $3, 'success', 'Reconciliation topup', $4, $5)`,
                            [crypto.randomUUID(), walletId, payment.amount, payment.payment_id, gatewayTxnId]
                        );
                    }

                    // Create Outbox Event
                    const eventPayload = {
                        eventId: crypto.randomUUID(),
                        eventType: EVENT_TYPES.PAYMENT_SUCCEEDED,
                        aggregateType: "payment",
                        aggregateId: payment.payment_id,
                        payload: { paymentId: payment.payment_id, userId: payment.user_id, amount: parseFloat(payment.amount), gatewayTxnId }
                    };
                    await client.query(
                        `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                         VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                        [eventPayload.eventId, eventPayload.eventType, eventPayload.aggregateType, eventPayload.aggregateId, JSON.stringify(eventPayload.payload)]
                    );
                }

                await client.query("COMMIT");
                await redis.del(`cache:balance:${payment.user_id}`, `cache:txns:${payment.user_id}`);
                logger.info("Payment reconciled successfully", { paymentId: payment.payment_id, newStatus: providerStatus });
            } catch (err) {
                await client.query("ROLLBACK");
                logger.error("Reconciliation error for payment", { paymentId: payment.payment_id, error: err.message });
            } finally {
                client.release();
            }
        }
    } catch (err) {
        logger.error("Reconciliation loop error", { error: err.message });
    }
}

function startReconciliationWorker(intervalMs = 10000) {
    logger.info("Reconciliation Worker started polling...");
    const interval = setInterval(reconcileUnresolvedPayments, intervalMs);
    return () => clearInterval(interval);
}

if (require.main === module) {
    startReconciliationWorker();
}

module.exports = { reconcileUnresolvedPayments, startReconciliationWorker };
