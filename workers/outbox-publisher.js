const { Queue } = require("bullmq");
const { getPgPool, createBullConnection } = require("../packages/database");
const { QUEUES, EVENT_TYPES } = require("../packages/shared-events");
const logger = require("../packages/logger");

const queueMap = {
    [EVENT_TYPES.PAYMENT_CREATED]: QUEUES.PAYMENT_PROCESS,
    [EVENT_TYPES.PAYMENT_PROCESSING]: QUEUES.PAYMENT_PROCESS,
    [EVENT_TYPES.PAYMENT_SUCCEEDED]: QUEUES.PAYMENT_SUCCEEDED,
    [EVENT_TYPES.PAYMENT_FAILED]: QUEUES.PAYMENT_FAILED,
    [EVENT_TYPES.TRANSFER_SUCCEEDED]: QUEUES.NOTIFICATION_SEND,
    [EVENT_TYPES.TRANSFER_FAILED]: QUEUES.NOTIFICATION_SEND,
    [EVENT_TYPES.REFUND_INITIATED]: QUEUES.PAYMENT_REFUND,
    [EVENT_TYPES.REFUND_COMPLETED]: QUEUES.NOTIFICATION_SEND,
    [EVENT_TYPES.WEBHOOK_RECEIVED]: QUEUES.PAYMENT_WEBHOOK
};

const activeQueues = {};

function getQueue(queueName) {
    if (!activeQueues[queueName]) {
        activeQueues[queueName] = new Queue(queueName, {
            connection: createBullConnection()
        });
    }
    return activeQueues[queueName];
}

async function publishOutboxEvents() {
    const pool = getPgPool();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const res = await client.query(
            `SELECT * FROM outbox_events 
             WHERE status = 'PENDING' 
             ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`
        );

        for (const event of res.rows) {
            const queueName = queueMap[event.event_type] || QUEUES.PAYMENT_PROCESS;
            const queue = getQueue(queueName);

            await queue.add(event.event_type, {
                eventId: event.event_id,
                aggregateType: event.aggregate_type,
                aggregateId: event.aggregate_id,
                ...event.payload
            }, {
                jobId: event.event_id,
                attempts: 3,
                backoff: { type: "exponential", delay: 1000 }
            });

            await client.query(
                `UPDATE outbox_events 
                 SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [event.id]
            );
            logger.info("Outbox event published", { eventId: event.event_id, eventType: event.event_type, queueName });
        }

        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Outbox publisher error", { error: err.message });
    } finally {
        client.release();
    }
}

function startOutboxPublisher(intervalMs = 2000) {
    logger.info("Outbox Publisher started polling...");
    const interval = setInterval(publishOutboxEvents, intervalMs);
    return () => clearInterval(interval);
}

if (require.main === module) {
    startOutboxPublisher();
}

module.exports = { publishOutboxEvents, startOutboxPublisher };
