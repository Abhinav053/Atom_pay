const { Worker, Queue } = require("bullmq");
const { getPgPool, getRedis, createBullConnection, connectMongoDB } = require("../../packages/database");
const { QUEUES, EVENT_TYPES } = require("../../packages/shared-events");
const { createCircuitBreaker } = require("../../packages/circuit-breaker");
const logger = require("../../packages/logger");
const mongoose = require("mongoose");

const crypto = require("crypto");

// Provider Mock Call (simulating provider gateway)
async function callExternalProvider({ paymentId, userId, amount, provider }) {
    // 10% chance provider unavailable (throw network timeout error)
    if (Math.random() < 0.10) {
        const error = new Error("Payment gateway network timeout");
        error.code = "GATEWAY_TIMEOUT";
        throw error;
    }

    const gatewayTxnId = `mock_gw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const redis = getRedis();
    const stateKey = `mock_provider:pay:${paymentId}`;

    // Store initial provider state as PROCESSING in Redis store (24h TTL)
    await redis.set(stateKey, JSON.stringify({
        paymentId,
        userId,
        amount: parseFloat(amount),
        provider: provider || "MOCK_GATEWAY",
        gatewayTxnId,
        status: "PROCESSING",
        failureReason: null
    }), "EX", 86400);

    // Asynchronously determine payment result & dispatch signed Webhook to Webhook Service
    setTimeout(async () => {
        const status = Math.random() < 0.8 ? "SUCCESS" : "FAILED";
        const failureReason = status === "FAILED" ? "Insufficient funds in provider bank" : null;

        // Persist final provider status in state store
        await redis.set(stateKey, JSON.stringify({
            paymentId,
            userId,
            amount: parseFloat(amount),
            provider: provider || "MOCK_GATEWAY",
            gatewayTxnId,
            status,
            failureReason
        }), "EX", 86400);

        const webhookPayload = {
            paymentId,
            userId,
            amount: parseFloat(amount),
            status,
            gatewayTxnId,
            failureReason,
            provider: provider || "MOCK_GATEWAY"
        };

        const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "dev-payment-webhook-secret";
        const webhookUrl = process.env.PAYMENT_WEBHOOK_URL || "http://localhost:3005/payment";

        const signature = crypto
            .createHmac("sha256", webhookSecret)
            .update(JSON.stringify(webhookPayload))
            .digest("hex");

        try {
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-payment-signature": signature
                },
                body: JSON.stringify(webhookPayload)
            });
            logger.info("Mock external provider sent webhook callback", { paymentId, status, httpStatus: response.status });
        } catch (err) {
            logger.error("Mock external provider webhook delivery error", { paymentId, error: err.message });
        }
    }, 500);

    // Synchronous initiation acceptance response to worker
    return {
        accepted: true,
        paymentId,
        gatewayTxnId
    };
}

async function getExternalPaymentStatus(paymentId) {
    try {
        const redis = getRedis();
        const raw = await redis.get(`mock_provider:pay:${paymentId}`);
        if (!raw) {
            return {
                paymentId,
                status: "PROCESSING",
                gatewayTxnId: null,
                failureReason: null
            };
        }
        return JSON.parse(raw);
    } catch (err) {
        logger.error("Error querying provider status API", { paymentId, error: err.message });
        return {
            paymentId,
            status: "PROCESSING",
            gatewayTxnId: null,
            failureReason: err.message
        };
    }
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
                    // Initiate Payment with Provider via Circuit Breaker
                    providerResult = await paymentBreaker.fire({ paymentId, userId, amount, provider });
                } catch (err) {
                    logger.error("Provider initiation error / timeout", { paymentId, error: err.message });
                    // CRITICAL REQUIREMENT: Mark state as UNKNOWN, do NOT mark as FAILED on network/timeout error!
                    await pool.query(
                        `UPDATE payments SET status = 'UNKNOWN', failure_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE payment_id = $2`,
                        [err.message, paymentId]
                    );
                    return { status: "UNKNOWN", error: err.message };
                }

                // Record Initial Payment Attempt in PostgreSQL
                await pool.query(
                    `INSERT INTO payment_attempts (payment_id, attempt_number, provider, provider_payment_id, status, error_message)
                     VALUES ($1, $2, $3, $4, 'PROCESSING', NULL)`,
                    [paymentId, job.attemptsMade + 1, provider || "MOCK_GATEWAY", providerResult.gatewayTxnId]
                );

                // Update Payment with Gateway Transaction ID (State remains PROCESSING, awaiting webhook)
                await pool.query(
                    `UPDATE payments SET gateway_txn_id = $1, updated_at = CURRENT_TIMESTAMP WHERE payment_id = $2`,
                    [providerResult.gatewayTxnId, paymentId]
                );

                logger.info("Payment worker initiated payment, awaiting webhook callback", { paymentId, gatewayTxnId: providerResult.gatewayTxnId });
                return { status: "INITIATED", accepted: true, paymentId, gatewayTxnId: providerResult.gatewayTxnId };
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
module.exports.startPaymentWorker = startPaymentWorker;
module.exports.callExternalProvider = callExternalProvider;
module.exports.getExternalPaymentStatus = getExternalPaymentStatus;
