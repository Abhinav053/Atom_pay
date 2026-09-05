/**
 * AtomPay Structured JSON Logger
 * Formats all log entries as structured JSON and redacts sensitive parameters.
 */

const SENSITIVE_FIELDS = new Set([
    "password", "userpassword", "oldpassword", "newpassword",
    "pin", "hashedpin", "oldpin", "newpin", "otp",
    "jwt_secret", "otp_secret", "brevo_api_key", "secret",
    "authorization", "cookie"
]);

function sanitize(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);

    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
            clean[key] = "[REDACTED]";
        } else if (value && typeof value === "object") {
            clean[key] = sanitize(value);
        } else {
            clean[key] = value;
        }
    }
    return clean;
}

function log(level, message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...sanitize(context)
    };
    if (level === "error") {
        console.error(JSON.stringify(entry));
    } else if (level === "warn") {
        console.warn(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

module.exports = {
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
    debug: (msg, ctx) => log("debug", msg, ctx),
    sanitize
};
