const { Worker } = require("bullmq");
const Payment = require("../db/payment");
const { createBullConnection } = require("../db/redis");
const { processPayment } = require("../services/gateway.service");

const startPaymentWorker = () => {
    const worker = new Worker(
        "paymentQueue",
        async (job) => {
            const { paymentId } = job.data;

            const payment = await Payment.findOneAndUpdate(
                { paymentId, status: { $in: ["PENDING", "PROCESSING"] } },
                { status: "PROCESSING" },
                { new: true }
            );

            if (!payment) {
                const current = await Payment.findOne({ paymentId }).select("status");
                if (current && ["SUCCESS", "FAILED"].includes(current.status)) return;
                throw new Error(`Payment ${paymentId} is not ready for processing`);
            }

            await processPayment(job.data);
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("completed", (job) => console.log("payment job done:", job.id));
    worker.on("failed", async (job, err) => {
        console.log("payment job failed:", job?.id, err.message);
        if (!job || job.attemptsMade < (job.opts.attempts || 1)) return;
        await Payment.findOneAndUpdate(
            { paymentId: job.data.paymentId, status: "PROCESSING" },
            { status: "FAILED", failureReason: err.message }
        );
    });
    return worker;
};

module.exports = startPaymentWorker;
