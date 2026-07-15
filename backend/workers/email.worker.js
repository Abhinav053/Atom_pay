const { Worker } = require("bullmq");
const { createBullConnection } = require("../db/redis");
const User = require("../db/user");
const { sendTransactionEmail } = require("../utils/mailer");

// Processes "email" jobs off the request path. Currently transaction emails;
// the worker looks up the user's email so producers stay lightweight.
const startEmailWorker = () => {
    const worker = new Worker(
        "email",
        async (job) => {
            const { type, userId } = job.data;
            if (type === "transaction") {
                const user = await User.findOne({ _id: userId }).select("email");
                if (!user || !user.email) return;
                await sendTransactionEmail(user.email, job.data);
            }
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("completed", (job) => console.log("email job done:", job.id));
    worker.on("failed", (job, err) => console.log("email job failed:", job?.id, err.message));
    return worker;
};

module.exports = startEmailWorker;
