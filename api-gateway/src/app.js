const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const verifyJWT = require("./middleware/auth");
const rateLimiter = require("./middleware/rateLimiter");
const idempotency = require("./middleware/idempotency");
const logger = require("../../packages/logger");

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CORS_ORIGINS || "*").split(",").map(s => s.trim());
app.use(cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "x-payment-signature"]
}));

app.use(express.json({ limit: "100kb" }));

// Security Headers & Request/Trace ID Propagation
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");

    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    const correlationId = req.headers["x-correlation-id"] || requestId;
    req.headers["x-request-id"] = requestId;
    req.headers["x-correlation-id"] = correlationId;
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Correlation-ID", correlationId);

    next();
});

// Root & Health Check
app.get("/", (req, res) => res.json({ msg: "AtomPay API Gateway is running", api: "/api" }));
app.get("/api", (req, res) => res.json({ msg: "working properly", maintenance: process.env.MAINTENANCE_MODE === "true" }));

// Maintenance Mode Middleware
app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE === "true") {
        return res.status(503).json({
            msg: "AtomPay is currently under maintenance. We'll be back shortly!",
            maintenance: true
        });
    }
    next();
});

// Internal Microservice URLs
const SERVICES = {
    AUTH: process.env.AUTH_SERVICE_URL || "http://localhost:3001",
    WALLET: process.env.WALLET_SERVICE_URL || "http://localhost:3002",
    PAYMENT: process.env.PAYMENT_SERVICE_URL || "http://localhost:3003",
    REFUND: process.env.REFUND_SERVICE_URL || "http://localhost:3004",
    WEBHOOK: process.env.WEBHOOK_SERVICE_URL || "http://localhost:3005",
    LEDGER: process.env.LEDGER_SERVICE_URL || "http://localhost:3006",
    NOTIFICATION: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3007",
    AGENT: process.env.AGENT_SERVICE_URL || "http://localhost:8000"
};

// Generic HTTP Proxy Helper
async function proxyRequest(targetUrl, req, res) {
    try {
        const headers = { ...req.headers };
        delete headers["host"];
        delete headers["content-length"];

        const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: ["POST", "PATCH", "PUT"].includes(req.method) ? JSON.stringify(req.body) : undefined
        });

        const data = await response.json().catch(() => ({}));
        return res.status(response.status).json(data);
    } catch (err) {
        logger.error("Gateway proxy error", { targetUrl, error: err.message });
        return res.status(502).json({ msg: "Service unavailable / proxy error" });
    }
}

// ── Rate Limiters for Gateway ──
const authLimiter = rateLimiter({ keyPrefix: "rl:gw:auth", windowMs: 15 * 60 * 1000, max: 30 });
const walletLimiter = rateLimiter({ keyPrefix: "rl:gw:wallet", windowMs: 10 * 1000, max: 30, identifier: req => req.headers["x-user-id"] || req.ip });

// ── Service Routes ──

// Auth Service Routes
app.use("/api/auth", authLimiter, (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.AUTH}${targetPath}`, req, res);
});

// Wallet Service Routes & Legacy Transactions Route Alias
app.use(["/api/wallet", "/api/transaction"], walletLimiter, verifyJWT, idempotency(), (req, res) => {
    const targetPath = req.url;
    if (targetPath.startsWith("/topup")) {
        return proxyRequest(`${SERVICES.PAYMENT}${targetPath}`, req, res);
    }
    proxyRequest(`${SERVICES.WALLET}${targetPath}`, req, res);
});

// Payment Service Routes
app.use("/api/payments", verifyJWT, idempotency(), (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.PAYMENT}${targetPath}`, req, res);
});

// Refund Service Routes
app.use("/api/refunds", verifyJWT, idempotency(), (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.REFUND}${targetPath}`, req, res);
});

// Webhook Service Routes & Legacy /webhook Alias
app.use(["/api/webhooks", "/webhook"], (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.WEBHOOK}${targetPath}`, req, res);
});

// Ledger Service Routes
app.use("/api/ledger", verifyJWT, (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.LEDGER}${targetPath}`, req, res);
});

// Agent Service Routes (AtomAI)
app.use("/api/agent", verifyJWT, (req, res) => {
    const targetPath = req.url;
    proxyRequest(`${SERVICES.AGENT}${targetPath}`, req, res);
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ msg: "Route not found" });
});

// Central Error Handler
app.use((err, req, res, next) => {
    logger.error("Gateway error", { error: err.message });
    res.status(err.status || 500).json({ msg: err.message || "Internal server error" });
});

module.exports = app;
