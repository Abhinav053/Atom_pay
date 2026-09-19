const { Worker, Queue } = require("bullmq");
const crypto = require("crypto");
const { getPgPool, createBullConnection } = require("../../packages/database");
const { QUEUES, EVENT_TYPES } = require("../../packages/shared-events");
const logger = require("../../packages/logger");
const { evaluatePolicy, ACTIONS } = require("./policy");

const DIAGNOSIS_SERVICE_URL = process.env.DIAGNOSIS_SERVICE_URL || "http://localhost:8000/diagnose";

// Initialize Execution Queue
const executionQueue = new Queue(QUEUES.RECOVERY_EXECUTE, {
    connection: createBullConnection()
});

async function callDiagnosisService(context) {
    try {
        const response = await fetch(DIAGNOSIS_SERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(context)
        });
        if (!response.ok) {
            throw new Error(`Diagnosis service HTTP error: ${response.status}`);
        }
        return await response.json();
    } catch (err) {
        logger.error("Failed to call diagnosis service", { error: err.message });
        return {
            category: "UNKNOWN",
            confidence: 0,
            evidence: err.message
        };
    }
}

function startRecoveryOrchestrator() {
    const worker = new Worker(
        QUEUES.PAYMENT_FAILED,
        async (job) => {
            const { paymentId, userId, amount, provider, failureReason } = job.data;
            const pool = getPgPool();
            const client = await pool.connect();
            let attemptCount = 1;
            let previousProviders = [provider];

            try {
                // Gather Context
                const attemptsRes = await client.query("SELECT attempt_number, provider FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number DESC", [paymentId]);
                if (attemptsRes.rows.length > 0) {
                    attemptCount = attemptsRes.rows[0].attempt_number;
                    previousProviders = attemptsRes.rows.map(r => r.provider);
                }

                // Deduplication Check for Orchestration to prevent multiple recoveries for same attempt
                const recoveryId = `rec_${paymentId}_${attemptCount}`;
                const checkRes = await client.query("SELECT id FROM recovery_audit WHERE recovery_id = $1", [recoveryId]);
                if (checkRes.rows.length > 0) {
                    logger.info("Recovery already orchestrated for this attempt", { recoveryId });
                    return { status: "ALREADY_ORCHESTRATED" };
                }

                const context = {
                    paymentId,
                    amount: parseFloat(amount),
                    provider,
                    paymentMethod: "UNKNOWN", // Extendable
                    failureCode: "UNKNOWN", // Could map from failureReason
                    failureMessage: failureReason,
                    attemptCount,
                    previousProviders,
                    riskHold: false // Extendable
                };

                // Call AI Diagnosis
                const diagnosis = await callDiagnosisService(context);

                // Call Deterministic Policy Engine
                const action = evaluatePolicy(diagnosis, context);

                // Write Audit Log
                await client.query(
                    `INSERT INTO recovery_audit (
                        recovery_id, payment_id, diagnosis_category, diagnosis_confidence, 
                        diagnosis_evidence, policy_action, attempt_number, provider, 
                        execution_status, amount_at_risk
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9)`,
                    [
                        recoveryId, paymentId, diagnosis.category, diagnosis.confidence,
                        diagnosis.evidence, action, attemptCount, provider, context.amount
                    ]
                );

                logger.info("Recovery Orchestrated", { recoveryId, paymentId, action, category: diagnosis.category });

                // Dispatch to Executor
                if (action !== ACTIONS.NO_ACTION) {
                    await executionQueue.add("execute", {
                        recoveryId,
                        paymentId,
                        userId,
                        amount,
                        action,
                        reason: diagnosis.category,
                        attemptCount,
                        previousProviders
                    }, {
                        jobId: `exec_${recoveryId}`,
                        attempts: 3,
                        backoff: { type: "exponential", delay: 1000 }
                    });
                }

                return { recoveryId, action, diagnosis };
            } catch (err) {
                logger.error("Recovery orchestration failed", { error: err.message, paymentId });
                throw err;
            } finally {
                client.release();
            }
        },
        { connection: createBullConnection(), concurrency: 2 }
    );

    worker.on("failed", (job, err) => {
        logger.error(`Recovery Orchestrator job ${job?.id} failed`, { error: err.message });
    });

    return worker;
}

if (require.main === module) {
    startRecoveryOrchestrator();
    logger.info("Recovery Orchestrator started");
}

module.exports = startRecoveryOrchestrator;
