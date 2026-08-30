const { Worker, Queue } = require("bullmq");
const { getPgPool, getRedis, createBullConnection, connectMongoDB } = require("../../packages/database");
const { QUEUES, EVENT_TYPES } = require("../../packages/shared-events");
const { createCircuitBreaker } = require("../../packages/circuit-breaker");
const logger = require("../../packages/logger");
const mongoose = require("mongoose");

// Provider Mock Call (simulating provider gateway)
async function callExternalProvider({ paymentId, userId, amount, provider }) {
    // 10% chance provider unavailable (throw network timeout error)
    if (Math.random() < 0.10) {
        const error = new Error("Payment gateway network timeout");
        error.code = "GATEWAY_TIMEOUT";
        throw error;
    }

    // 80% success rate
    const status = Math.random() < 0.8 ? "SUCCESS" : "FAILED";
    return {
        paymentId,
        status,
        gatewayTxnId: `mock_gw_${Date.now()}`,
        failureReason: status === "FAILED" ? "Insufficient funds in provider bank" : null
    };
}

const paymentBreaker = createCircuitBreaker(callExternalProvider, {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000
});

// MongoDB DLQ Schema
const DLQSchema = new mongoose.Schema({
    jobId: { type: String, required: true },
    paymentId: { type: String, required: true },
    attemptId: { type: String },
    failureReason: { type: String },
    retryCount: { type: Number },
    stack: { type: String },
    timestamp: { type: Date, default: Date.now }
});

let DLQRecord;
try {
    DLQRecord = mongoose.model("DLQRecord");
} catch {
    DLQRecord = mongoose.model("DLQRecord", DLQSchema);
}

function startPaymentWorker() {
    const worker = new Worker(
        QUEUES.PAYMENT_PROCESS,
        async (job) => {
            const { paymentId, userId, amount, provider } = job.data;
            const redis = getRedis();
            const lockKey = `payment:lock:${paymentId}`;

            // Acquire Redis Distributed Lock (TTL 30 seconds)
            const acquired = await redis.set(lockKey, "1", "NX", "EX", 30);
            if (!acquired) {
                logger.warn("Payment job already locked by another worker", { paymentId });
                return { status: "LOCKED" };
            }

            const pool = getPgPool();
            try {
                // Fetch Payment State
                const payRes = await pool.query("SELECT * FROM payments WHERE payment_id = $1", [paymentId]);
                if (payRes.rows.length === 0) return { status: "NOT_FOUND" };
                const payment = payRes.rows[0];

                if (payment.status === "SUCCESS" || payment.status === "FAILED") {
                    return { status: "ALREADY_TERMINAL", currentStatus: payment.status };
                }

                // Update Payment to PROCESSING
                await pool.query("UPDATE payments SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP WHERE payment_id = $1", [paymentId]);

                let providerResult;
                try {
                    // Call Provider via Circuit Breaker
                    providerResult = await paymentBreaker.fire({ paymentId, userId, amount, provider });
                } catch (err) {
                    logger.error("Provider execution error / timeout", { paymentId, error: err.message });
                    // CRITICAL REQUIREMENT: Mark state as UNKNOWN, do NOT mark as FAILED on network/timeout error!
                    await pool.query(
                        `UPDATE payments SET status = 'UNKNOWN', failure_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE payment_id = $2`,
                        [err.message, paymentId]
                    );
                    return { status: "UNKNOWN", error: err.message };
                }

                // Record Payment Attempt in PostgreSQL
                await pool.query(
                    `INSERT INTO payment_attempts (payment_id, attempt_number, provider, provider_payment_id, status, error_message)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [paymentId, job.attemptsMade + 1, provider || "MOCK_GATEWAY", providerResult.gatewayTxnId, providerResult.status, providerResult.failureReason]
                );

                // Update Payment Final Status
                await pool.query(
                    `UPDATE payments SET status = $1, gateway_txn_id = $2, failure_reason = $3, updated_at = CURRENT_TIMESTAMP WHERE payment_id = $4`,
                    [providerResult.status, providerResult.gatewayTxnId, providerResult.failureReason, paymentId]
                );

                logger.info("Payment worker processed attempt", { paymentId, status: providerResult.status });
                return providerResult;
            } finally {
                // Release Redis Distributed Lock
                await redis.del(lockKey);
            }
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("failed", async (job, err) => {
        logger.error(`Payment job ${job?.id} failed`, { attempts: job?.attemptsMade, error: err.message });
        if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
            // Push to Dead Letter Queue (DLQ)
            try {
                await connectMongoDB();
                await DLQRecord.create({
                    jobId: job.id,
                    paymentId: job.data.paymentId,
                    failureReason: err.message,
                    retryCount: job.attemptsMade,
                    stack: err.stack
                });
                logger.error("Job moved to DLQ", { jobId: job.id, paymentId: job.data.paymentId });
            } catch (dlqErr) {
                logger.error("Failed to write to DLQ", { error: dlqErr.message });
            }
        }
    });

    return worker;
}

if (require.main === module) {
    startPaymentWorker();
}

module.exports = startPaymentWorker;
