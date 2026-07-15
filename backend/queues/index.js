const { Queue } = require("bullmq");
const { createBullConnection } = require("../db/redis");

// Producers only. Workers live in workers/ and run in a separate process
// (npm run start:worker). Queues are created lazily so importing controllers
// never opens Redis or breaks app startup when queues are unavailable.
let connection = null;
let emailQueue = null;
let auditQueue = null;

const getQueues = () => {
    if (!connection) connection = createBullConnection();
    if (!emailQueue) emailQueue = new Queue("email", { connection });
    if (!auditQueue) auditQueue = new Queue("audit", { connection });
    return { emailQueue, auditQueue };
};

// Retry transient failures with exponential backoff; auto-trim old jobs.
const jobOpts = {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
};

// Fire-and-forget producers — fail OPEN so a Redis/queue issue never affects the
// request that triggered them (the money has already moved safely).
const enqueueEmail = (data) => {
    try {
        getQueues().emailQueue.add("email", data, jobOpts)
            .catch((err) => console.log("enqueueEmail error:", err.message));
    } catch (err) {
        console.log("enqueueEmail error:", err.message);
    }
};

const enqueueAudit = (data) => {
    try {
        getQueues().auditQueue.add("audit", data, jobOpts)
            .catch((err) => console.log("enqueueAudit error:", err.message));
    } catch (err) {
        console.log("enqueueAudit error:", err.message);
    }
};

const closeQueues = async () => {
    if (emailQueue) await emailQueue.close();
    if (auditQueue) await auditQueue.close();
    if (connection) await connection.quit();
    emailQueue = null;
    auditQueue = null;
    connection = null;
};

module.exports = { getQueues, enqueueEmail, enqueueAudit, closeQueues };
