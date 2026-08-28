const { getRedis, getPgPool } = require("../../../packages/database");

/**
 * Idempotency Middleware for API Gateway
 * Fast Redis claim (`SET NX`), persisted durably in PostgreSQL `idempotency_records`.
 */
function idempotency() {
    return async (req, res, next) => {
        const key = req.headers["idempotency-key"];
        if (!key) return next();

        const userId = req.headers["x-user-id"] || "anonymous";
        const redisKey = `idem:${userId}:${req.method}:${req.baseUrl}${req.path}:${key}`;
        const redis = getRedis();
        const pool = getPgPool();

        try {
            // Check Redis fast claim
            const claimed = await redis.set(
                redisKey,
                JSON.stringify({ status: "pending" }),
                "EX", 60,
                "NX"
            );

            if (!claimed) {
                // Check cached response in Redis
                const cachedRedis = await redis.get(redisKey);
                if (cachedRedis) {
                    const parsed = JSON.parse(cachedRedis);
                    if (parsed.status === "pending") {
                        return res.status(409).json({ msg: "A request with this Idempotency-Key is already being processed" });
                    }
                    return res.status(parsed.statusCode).json(parsed.body);
                }

                // Fallback to PostgreSQL durable record
                const dbRes = await pool.query("SELECT response_status, response_body FROM idempotency_records WHERE key = $1", [key]);
                if (dbRes.rows.length > 0) {
                    const record = dbRes.rows[0];
                    return res.status(record.response_status).json(record.response_body);
                }

                return res.status(409).json({ msg: "A request with this Idempotency-Key is already being processed" });
            }
        } catch (err) {
            console.error("Idempotency check error:", err.message);
            return next();
        }

        // Intercept response to store result
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            const statusCode = res.statusCode;
            if (statusCode >= 200 && statusCode < 300) {
                // Cache in Redis
                redis.set(redisKey, JSON.stringify({ status: "done", statusCode, body }), "EX", 86400).catch(() => {});
                // Save durably in PostgreSQL
                pool.query(
                    `INSERT INTO idempotency_records (key, user_id, endpoint, response_status, response_body)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (key) DO UPDATE SET response_status = $4, response_body = $5`,
                    [key, userId !== "anonymous" ? userId : null, req.originalUrl, statusCode, JSON.stringify(body)]
                ).catch(() => {});
            } else {
                redis.del(redisKey).catch(() => {});
            }
            return originalJson(body);
        };

        next();
    };
}

module.exports = idempotency;
