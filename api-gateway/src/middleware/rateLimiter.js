const { getRedis } = require("../../../packages/database");

/**
 * Distributed sliding-window rate limiter using Redis sorted sets.
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
            const member = `${now}-${Math.random().toString(36).slice(2)}`;

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
            console.error("Rate limiter error (failing open):", err.message);
            return next();
        }
    };
};

module.exports = rateLimiter;
