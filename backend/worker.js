require("dotenv").config();
const connectDB = require("./db/db");
const startEmailWorker = require("./workers/email.worker");
const startAuditWorker = require("./workers/audit.worker");

const startWorkers = async () => {
    if (!process.env.MONGO_URL) throw new Error("Mongo url required");
    if (!process.env.REDIS_URL) throw new Error("Redis url required");

    await connectDB();
    const emailWorker = startEmailWorker();
    const auditWorker = startAuditWorker();

    console.log("Workers running: email, audit");

    const shutdown = async () => {
        await Promise.all([
            emailWorker.close(),
            auditWorker.close()
        ]);
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
};

startWorkers().catch((err) => {
    console.error("Workers failed to start:", err.message);
    process.exit(1);
});
