const { getRedis } = require("../db/redis");

/**
 * Distributed sliding-window-log rate limiter backed by a Redis sorted set.
 *
 * Each request adds a timestamped member to a per-identity ZSET; expired
 * members are trimmed on every call, and the live count is compared to `max`.
 * Because all state lives in Redis, the limit is enforced correctly across
 * horizontally scaled instances — unlike the previous in-memory Map limiter.
 *
 * @param {object}   opts
 * @param {string}   opts.keyPrefix    namespace for this limiter, e.g. "rl:login"
 * @param {number}   opts.windowMs     window size in milliseconds
 * @param {number}   opts.max          max requests allowed per window per identity
 * @param {function} [opts.identifier] (req) => string; defaults to client IP
 * @param {string}   [opts.message]    message returned on 429
 */
const rateLimiter = ({ keyPrefix, windowMs, max, identifier, message } = {}) => {
    if (!keyPrefix || !windowMs || !max) {
        throw new Error("rateLimiter requires keyPrefix, windowMs, and max");
    }

    const getId = identifier || ((req) => req.ip || req.connection?.remoteAddress || "unknown");
    const msg = message || "Too many requests, please try again later.";

    return async (req, res, next) => {
        try {
            const redis = getRedis();
            const id = getId(req);
            const key = `${keyPrefix}:${id}`;
            const now = Date.now();
            const windowStart = now - windowMs;
            // Member must be unique even for same-ms requests.
            const member = `${now}-${Math.random().toString(36).slice(2)}`;

           //multi ye ensure karta hai ki sare commannds parallel chale and concurrency problm naa aai
            const results = await redis
                .multi()
                .zremrangebyscore(key, 0, windowStart)
                .zadd(key, now, member)
                .zcard(key)
                .pexpire(key, windowMs)
                .exec();

            const count = results[2][1];
            const remaining = Math.max(0, max - count);

            res.setHeader("X-RateLimit-Limit", max);
            res.setHeader("X-RateLimit-Remaining", remaining);
            res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));

            if (count > max) {
                const retryAfter = Math.ceil(windowMs / 1000);
                res.setHeader("Retry-After", retryAfter);
                return res.status(429).json({ msg, retryAfter });
            }

            return next();
        } catch (err) {
            // Fail OPEN: a Redis outage should not take down auth/login entirely.
            // We log and let the request through; the Mongo-side checks still apply.
            console.error("Rate limiter error (failing open):", err.message);
            return next();
        }
    };
};

module.exports = { rateLimiter };