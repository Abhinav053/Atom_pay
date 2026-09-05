const express = require("express");
const crypto = require("crypto");
const { getPgPool } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");
const { getProvider } = require("./providers");

const app = express();
app.use(express.json());

// Valid Payment State Transitions Matrix
const VALID_TRANSITIONS = {
    CREATED: ["PROCESSING", "FAILED"],
    PROCESSING: ["SUCCESS", "FAILED", "UNKNOWN"],
    UNKNOWN: ["SUCCESS", "FAILED"],
    SUCCESS: ["REFUND_PENDING"],
    FAILED: [],
    REFUND_PENDING: ["REFUNDED", "REFUND_FAILED"],
    REFUNDED: [],
    REFUND_FAILED: []
};

function isValidTransition(fromState, toState) {
    const allowed = VALID_TRANSITIONS[fromState];
    return allowed && allowed.includes(toState);
}

// POST /topup - Initiate Top-up Payment
app.post(["/", "/topup"], async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const { amount } = req.body;
        const topupAmount = Number(amount);
        if (!Number.isFinite(topupAmount) || topupAmount <= 0) {
            return res.status(400).json({ msg: "Amount must be greater than 0" });
        }

        const paymentId = crypto.randomUUID();
        const providerName = "MOCK_GATEWAY";
        const pool = getPgPool();
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Create Payment Record
            const paymentRes = await client.query(
                `INSERT INTO payments (payment_id, user_id, amount, currency, status, provider)
                 VALUES ($1, $2, $3, 'INR', 'CREATED', $4) RETURNING *`,
                [paymentId, userId, topupAmount, providerName]
            );

            // Create Initial Payment Attempt Record
            await client.query(
                `INSERT INTO payment_attempts (payment_id, attempt_number, provider, status)
                 VALUES ($1, 1, $2, 'CREATED')`,
                [paymentId, providerName]
            );

            // Transactional Outbox Event for Payment Worker
            const outboxPayload = {
                eventId: crypto.randomUUID(),
                eventType: EVENT_TYPES.PAYMENT_CREATED,
                aggregateType: "payment",
                aggregateId: paymentId,
                payload: {
                    paymentId,
                    userId,
                    amount: topupAmount,
                    provider: providerName
                }
            };

            await client.query(
                `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                [outboxPayload.eventId, outboxPayload.eventType, outboxPayload.aggregateType, outboxPayload.aggregateId, JSON.stringify(outboxPayload.payload)]
            );

            await client.query("COMMIT");

            logger.info("Payment created", { paymentId, userId, amount: topupAmount });
            return res.status(202).json({
                message: "Top-up initiated",
                paymentId,
                status: "CREATED"
            });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        logger.error("Create payment error", { error: err.message });
        return res.status(500).json({ msg: "Failed to initiate payment" });
    }
});

// GET /:paymentId or /topup/:paymentId - Get Payment Status
app.get(["/:paymentId", "/topup/:paymentId"], async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const { paymentId } = req.params;

        const pool = getPgPool();
        const result = await pool.query(
            "SELECT * FROM payments WHERE payment_id = $1 AND user_id = $2",
            [paymentId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ msg: "Payment not found" });
        }

        const payment = result.rows[0];
        return res.json({
            paymentId: payment.payment_id,
            amount: parseFloat(payment.amount),
            status: payment.status,
            failureReason: payment.failure_reason || null,
            createdAt: payment.created_at,
            updatedAt: payment.updated_at
        });
    } catch (err) {
        logger.error("Get payment status error", { error: err.message });
        return res.status(500).json({ msg: "Failed to retrieve payment status" });
    }
});

const PORT = process.env.PORT || 3003;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Payment Service running on port ${PORT}`);
    });
}

module.exports = { app, isValidTransition };
