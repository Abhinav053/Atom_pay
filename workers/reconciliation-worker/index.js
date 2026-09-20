const { getPgPool, getRedis } = require("../../packages/database");
const logger = require("../../packages/logger");
const { createCircuitBreaker } = require("../../packages/circuit-breaker");
const { finalizePayment } = require("../../packages/payment-finalizer");
const { getExternalPaymentStatus } = require("../payment-worker");

// Wrap provider status query with Circuit Breaker
const statusBreaker = createCircuitBreaker(
    async (paymentId) => {
        return await getExternalPaymentStatus(paymentId);
    },
    {
        timeout: 5000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000
    }
);

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
            logger.info("Reconciling payment via Provider Status API", { paymentId: payment.payment_id, currentStatus: payment.status });

            let providerResult;
            try {
                // Call Provider Status API protected by Circuit Breaker
                providerResult = await statusBreaker.fire(payment.payment_id);
            } catch (err) {
                logger.error("Reconciliation provider status API call failed or timed out", { paymentId: payment.payment_id, error: err.message });
                continue; // Leave unresolved for next reconciliation cycle
            }

            const { status: providerStatus, gatewayTxnId, failureReason } = providerResult;

            // If provider is still PROCESSING, keep unresolved
            if (providerStatus === "PROCESSING") {
                logger.info("Payment still PROCESSING at provider, leaving unresolved", { paymentId: payment.payment_id });
                continue;
            }

            // If provider returned terminal status (SUCCESS or FAILED), execute common finalization logic
            if (providerStatus === "SUCCESS" || providerStatus === "FAILED") {
                try {
                    const finalRes = await finalizePayment({
                        pool,
                        redis,
                        paymentId: payment.payment_id,
                        status: providerStatus,
                        gatewayTxnId: gatewayTxnId || payment.gateway_txn_id,
                        failureReason: failureReason || null,
                        provider: payment.provider || "MOCK_GATEWAY",
                        source: "RECONCILIATION"
                    });

                    logger.info("Payment reconciled to terminal state", { paymentId: payment.payment_id, finalStatus: finalRes.status, duplicate: finalRes.duplicate });
                } catch (err) {
                    logger.error("Failed to reconcile payment finalization", { paymentId: payment.payment_id, error: err.message });
                }
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
