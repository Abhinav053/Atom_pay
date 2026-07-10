const Redis = require("ioredis");

// Shared Redis connections for AtomPay.
// - getRedis(): one reused client for caching / rate limiting (the "pool").
// - createBullConnection(): fresh dedicated connection for BullMQ (needs
//   maxRetriesPerRequest: null, must not share the cache client).
// - closeRedis(): used during graceful shutdown.
// Set REDIS_URL in .env (use rediss:// for TLS providers).

let cacheClient = null;

const getRedisUrl = () => {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not set in environment");
    return process.env.REDIS_URL;
};

const getRedis = () => {
    if (cacheClient) return cacheClient;
    cacheClient = new Redis(getRedisUrl(), {
        maxRetriesPerRequest: 1,
        // Must be comfortably above real round-trip latency to this Redis.
        // A remote/TLS provider can take ~400ms on a cold command; the old
        // 200ms cap made cacheDel() time out and fail-open, so a transfer's
        // balance invalidation silently never ran and the receiver saw a stale
        // balance until the 300s TTL expired. All cache ops are fail-open, so a
        // higher ceiling only adds latency in the rare case Redis is truly down.
        commandTimeout: 2000,
        enableReadyCheck: true,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    cacheClient.on("connect", () => console.log("Redis connected ✅"));
    cacheClient.on("error", (err) => console.error("Redis error:", err.message));
    return cacheClient;
};

const createBullConnection = () => {
    const conn = new Redis(getRedisUrl(), {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    conn.on("error", (err) => console.error("Redis (bullmq) error:", err.message));
    return conn;
};

const closeRedis = async () => {
    if (cacheClient) {
        await cacheClient.quit();
        cacheClient = null;
    }
};

module.exports = { getRedis, createBullConnection, closeRedis };