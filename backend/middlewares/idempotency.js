const { getRedis } = require("../db/redis");

// Redis-backed idempotency for money transfers.
//
// On the first request for an Idempotency-Key we atomically claim the key with
// SET NX (set-if-not-exists). Because the claim is a single atomic op, two
// concurrent retries can never both pass — the old Mongo findOne->create had a
// race window that allowed a double charge.
//
//   claim succeeds  -> first request: process, then cache the final response
//   claim fails     -> duplicate: replay cached response, or 409 if still pending
//
// Lock expires after LOCK_TTL so a crashed request can't block retries forever.
// Successful responses are cached for RESPONSE_TTL; failed ones release the lock
// so the same key can be retried.

const LOCK_TTL = 60;          // seconds — max processing time before lock frees
const RESPONSE_TTL = 86400;   // seconds — keep the success response for 24h

const idempotency = () => async (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (!key) return next();   // no key = normal processing

    const redisKey = `idem:${req.user.id}:${key}`;
    let redis;

    try {
        redis = getRedis();
        // Atomic claim: "OK" if the key did not exist, null if it already did.
        const claimed = await redis.set(
            redisKey,
            JSON.stringify({ status: "pending" }),
            "EX", LOCK_TTL,
            "NX"
        );

        if (!claimed) {
            const existing = await redis.get(redisKey);
            const parsed = existing ? JSON.parse(existing) : null;

            if (!parsed || parsed.status === "pending") {
                return res.status(409).json({
                    msg: "A request with this Idempotency-Key is already being processed"
                });
            }
            // Replay the stored response — no re-processing, no double charge.
            return res.status(parsed.statusCode).json(parsed.body);
        }
    } catch (err) {
        console.log("Idempotency check error:", err.message);
        return next();   // fail open on Redis error
    }

    // First request — capture the response so future duplicates can replay it.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
            redis.set(redisKey, JSON.stringify({ status: "done", statusCode, body }), "EX", RESPONSE_TTL)
                .catch((err) => console.log("Idempotency save error:", err.message));
        } else {
            // Failed request — release the lock so it can be retried with this key.
            redis.del(redisKey).catch((err) => console.log("Idempotency release error:", err.message));
        }
        return originalJson(body);
    };

    next();
};

module.exports = idempotency;