const express = require("express");
const crypto = require("crypto");
const { getPgPool } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");

const app = express();
app.use(express.json());

// POST /refunds - Initiate Refund
app.post(["/", "/refund"], async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const { paymentId, reason, amount } = req.body;
        if (!paymentId) return res.status(400).json({ msg: "Payment ID required" });

        const pool = getPgPool();
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Lock payment record
            const payRes = await client.query("SELECT * FROM payments WHERE payment_id = $1 AND user_id = $2 FOR UPDATE", [paymentId, userId]);
            if (payRes.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({ msg: "Payment not found" });
            }

            const payment = payRes.rows[0];
            if (payment.status !== "SUCCESS") {
                await client.query("ROLLBACK");
                return res.status(400).json({ msg: `Cannot refund payment in status ${payment.status}` });
            }

            const refundAmount = amount ? Number(amount) : parseFloat(payment.amount);
            const refundId = `ref_${crypto.randomUUID()}`;

            // Create Refund Record
            const refundRes = await client.query(
                `INSERT INTO refunds (refund_id, payment_id, user_id, amount, status, reason)
                 VALUES ($1, $2, $3, $4, 'REFUND_PENDING', $5) RETURNING *`,
                [refundId, paymentId, userId, refundAmount, reason || "Customer request"]
            );

            // Update Payment Status
            await client.query("UPDATE payments SET status = 'REFUND_PENDING', updated_at = CURRENT_TIMESTAMP WHERE payment_id = $1", [paymentId]);

            // Transactional Outbox Event
            const outboxPayload = {
                eventId: crypto.randomUUID(),
                eventType: EVENT_TYPES.REFUND_INITIATED,
                aggregateType: "refund",
                aggregateId: refundId,
                payload: { refundId, paymentId, userId, amount: refundAmount }
            };

            await client.query(
                `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
                 VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
                [outboxPayload.eventId, outboxPayload.eventType, outboxPayload.aggregateType, outboxPayload.aggregateId, JSON.stringify(outboxPayload.payload)]
            );

            await client.query("COMMIT");

            logger.info("Refund initiated", { refundId, paymentId, amount: refundAmount });
            return res.status(202).json({
                message: "Refund initiated",
                refundId,
                status: "REFUND_PENDING"
            });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        logger.error("Refund initiation error", { error: err.message });
        return res.status(500).json({ msg: "Failed to initiate refund" });
    }
});

const PORT = process.env.PORT || 3004;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Refund Service running on port ${PORT}`);
    });
}

module.exports = app;
