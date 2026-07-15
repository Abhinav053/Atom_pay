const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middlewares");
const { validate } = require("../middlewares/validate");
const { transferMoney } = require("../controllers/transections.controller");
const { transferSchema } = require("../validators/transfer.Schema");
const idempotency = require("../middlewares/idempotency");
const { rateLimiter } = require("../middlewares/rateLimiter");

// Per-user request-rate limit on transfers (abuse / scripting guard).
// This is the request-frequency cap; the ₹1,00,000/24h MONEY velocity cap is
// enforced separately inside the transfer flow (Redis advisory + Mongo backstop).
const transferLimiter = rateLimiter({
    keyPrefix: "rl:transfer",
    windowMs: 10 * 1000, // 10 seconds
    max: 30,
    identifier: (req) => req.user.id,
    message: "Too many transfer attempts. Please wait 10 seconds and try again.",
});

router.post("/transfer", authMiddleware, transferLimiter, validate(transferSchema), idempotency(), transferMoney);

module.exports = router;