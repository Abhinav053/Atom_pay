const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { getPgPool, getRedis, connectMongoDB } = require("../../packages/database");
const logger = require("../../packages/logger");
const { EVENT_TYPES } = require("../../packages/shared-events");
const { finalizePayment } = require("../../packages/payment-finalizer");

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

        // Process Financial Update in PostgreSQL via shared finalizePayment helper
        try {
            const result = await finalizePayment({
                pool: getPgPool(),
                redis,
                paymentId,
                status,
                gatewayTxnId,
                failureReason: failureReason || null,
                provider: provider || "MOCK_GATEWAY",
                source: "WEBHOOK"
            });

            if (result.status === "NOT_FOUND") {
                await redis.del(dedupeKey);
                return res.status(404).json({ msg: "Payment not found" });
            }

            if (result.duplicate) {
                return res.status(200).json({ duplicate: true, message: "Payment already in terminal state" });
            }

            logger.info("Payment webhook processed successfully", { paymentId, status });
            return res.status(200).json({ duplicate: false, message: "Payment webhook processed" });
        } catch (dbErr) {
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
