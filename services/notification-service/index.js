const express = require("express");
const mongoose = require("mongoose");
const { Worker } = require("bullmq");
const { createBullConnection, connectMongoDB } = require("../../packages/database");
const logger = require("../../packages/logger");
const { QUEUES } = require("../../packages/shared-events");

const app = express();
app.use(express.json());

// MongoDB Notification Log Schema
const NotificationLogSchema = new mongoose.Schema({
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    recipient: { type: String },
    status: { type: String, enum: ["SENT", "FAILED"], required: true },
    details: { type: Object },
    timestamp: { type: Date, default: Date.now }
});

let NotificationLog;
try {
    NotificationLog = mongoose.model("NotificationLog");
} catch {
    NotificationLog = mongoose.model("NotificationLog", NotificationLogSchema);
}

function startNotificationWorker() {
    const worker = new Worker(
        QUEUES.NOTIFICATION_SEND,
        async (job) => {
            logger.info("Processing notification job", { jobId: job.id, data: job.data });

            try {
                await connectMongoDB();
                // Simulate sending email / push notification
                await NotificationLog.create({
                    eventId: job.data.eventId || job.id,
                    type: job.name || "NOTIFICATION",
                    recipient: job.data.userId || "user",
                    status: "SENT",
                    details: job.data
                });
            } catch (mongoErr) {
                logger.error("Failed to log notification", { error: mongoErr.message });
            }

            return { status: "SENT" };
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("completed", (job) => logger.info(`Notification sent for job ${job.id}`));
    worker.on("failed", (job, err) => logger.error(`Notification job ${job?.id} failed`, { error: err.message }));
    return worker;
}

const PORT = process.env.PORT || 3007;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Notification Service running on port ${PORT}`);
        startNotificationWorker();
    });
}

module.exports = { app, startNotificationWorker };
