const { Worker } = require("bullmq");
const { createBullConnection } = require("../db/redis");
const AuditLog = require("../db/auditLog");

// Persists audit/analytics records off the request path so the API thread is
// never blocked writing tracking data.
const startAuditWorker = () => {
    const worker = new Worker(
        "audit",
        async (job) => {
            await AuditLog.create(job.data);
        },
        { connection: createBullConnection(), concurrency: 5 }
    );

    worker.on("failed", (job, err) => console.log("audit job failed:", job?.id, err.message));
    return worker;
};

module.exports = startAuditWorker;