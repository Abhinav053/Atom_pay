const { Worker, Queue } = require("bullmq");
const { getPgPool, createBullConnection } = require("../../packages/database");
const { QUEUES } = require("../../packages/shared-events");
const logger = require("../../packages/logger");

const paymentQueue = new Queue(QUEUES.PAYMENT_PROCESS, {
    connection: createBullConnection()
});

const notificationQueue = new Queue(QUEUES.NOTIFICATION_SEND, {
    connection: createBullConnection()
});

function startRecoveryExecutor() {
    const worker = new Worker(
        QUEUES.RECOVERY_EXECUTE,
        async (job) => {
            const { recoveryId, paymentId, userId, amount, action, reason, attemptCount, previousProviders } = job.data;
            const pool = getPgPool();
            const client = await pool.connect();
            
            try {
                // Ensure idempotency / prevent duplicate execution
                const auditRes = await client.query("SELECT execution_status FROM recovery_audit WHERE recovery_id = $1", [recoveryId]);
                if (auditRes.rows.length === 0) {
                    throw new Error("Audit record not found for recovery execution");
                }
                
                if (auditRes.rows[0].execution_status === 'EXECUTED') {
                    logger.info("Recovery already executed", { recoveryId });
                    return { status: "ALREADY_EXECUTED" };
                }

                if (action === "RETRY_SCHEDULED") {
                    // Logic to pick a new provider or keep same
                    const providerMap = { "ProviderA": "ProviderB", "ProviderB": "ProviderA", "MOCK_GATEWAY": "MOCK_GATEWAY" };
                    const lastProvider = previousProviders[0] || "MOCK_GATEWAY";
                    const newProvider = providerMap[lastProvider] || "MOCK_GATEWAY";

                    // Re-add to payment.process queue
                    await paymentQueue.add("process", {
                        paymentId,
                        userId,
                        amount,
                        provider: newProvider,
                        isRecoveryRetry: true
                    }, {
                        jobId: `retry_${paymentId}_${attemptCount}`,
                        attempts: 3
                    });
                    
                    logger.info("Payment retry scheduled via Recovery Executor", { paymentId, newProvider });
                } else if (action === "NOTIFY_CUSTOMER") {
                    await notificationQueue.add("send", {
                        userId,
                        type: "PAYMENT_FAILED",
                        message: `Your payment of ${amount} could not be completed. Reason: ${reason}. Please update your payment method.`
                    });
                    logger.info("Customer notification scheduled via Recovery Executor", { paymentId, userId });
                } else if (action === "ESCALATE_HUMAN") {
                    logger.warn("Manual escalation required for payment", { paymentId, reason, amount });
                    // Could send to a Slack channel or Ops queue here
                }

                // Update Audit Record
                await client.query(
                    `UPDATE recovery_audit SET execution_status = 'EXECUTED', updated_at = CURRENT_TIMESTAMP WHERE recovery_id = $1`,
                    [recoveryId]
                );

                return { status: "SUCCESS" };
            } catch (err) {
                logger.error("Recovery Execution failed", { error: err.message, recoveryId });
                // Mark audit as failed execution
                await client.query(
                    `UPDATE recovery_audit SET execution_status = 'FAILED', error_message = $1, updated_at = CURRENT_TIMESTAMP WHERE recovery_id = $2`,
                    [err.message, recoveryId]
                );
                throw err;
            } finally {
                client.release();
            }
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("failed", (job, err) => {
        logger.error(`Recovery Executor job ${job?.id} failed`, { error: err.message });
    });

    return worker;
}

if (require.main === module) {
    startRecoveryExecutor();
    logger.info("Recovery Executor started");
}

module.exports = startRecoveryExecutor;
