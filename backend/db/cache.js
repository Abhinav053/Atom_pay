const { getRedis } = require("./redis");

// Small JSON cache helpers over Redis. All fail OPEN — if Redis is down the
// caller simply falls back to MongoDB, so caching can never break a request.

const cacheGet = async (key) => {
    try {
        const val = await getRedis().get(key);
        return val ? JSON.parse(val) : null;
    } catch (err) {
        console.log("cacheGet error:", err.message);
        return null;
    }
};

const cacheSet = async (key, value, ttlSeconds) => {
    try {
        await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
        console.log("cacheSet error:", err.message);
    }
};

const cacheDel = async (...keys) => {
    try {
        if (keys.length) await getRedis().del(...keys);
    } catch (err) {
        console.log("cacheDel error:", err.message);
    }
};

module.exports = { cacheGet, cacheSet, cacheDel };