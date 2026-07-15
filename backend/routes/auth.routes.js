const express = require("express");
const router = express.Router();
const {
    signup, login,
    changePassword, changePin,
    sendOTP, verifyOTP,
    sendSignupOTP,
    forgotPassword, resetPassword,
    refresh, logout
} = require("../controllers/auth.controller");

const {
    signupSchema, loginSchema,
    changePasswordSchema, changePinSchema,
    sendOTPSchema, verifyOTPSchema,
    sendSignupOTPSchema,
    forgotPasswordSchema, resetPasswordSchema,
    refreshSchema, logoutSchema
} = require("../validators/auth.schema");
const authMiddleware = require("../middlewares/auth.middlewares");
const { validate } = require("../middlewares/validate");
const { rateLimiter } = require("../middlewares/rateLimiter");

// Rate limiters for auth endpoints (IP-based — these run before authentication)
const signupLimiter = rateLimiter({ keyPrefix: "rl:signup", windowMs: 15 * 60 * 1000, max: 15, message: "Too many signup attempts, please try again after 15 minutes." });
const loginLimiter  = rateLimiter({ keyPrefix: "rl:login", windowMs: 15 * 60 * 1000, max: 20, message: "Too many login attempts, please try again after 15 minutes." });

// Rate limiters for OTP endpoints — prevents OTP flooding / email abuse
const otpLimiter = rateLimiter({ keyPrefix: "rl:otp", windowMs: 60 * 1000, max: 5, message: "Too many OTP requests. Please wait 1 minute." });
const verifyOTPLimiter = rateLimiter({ keyPrefix: "rl:verify-otp", windowMs: 15 * 60 * 1000, max: 15, message: "Too many OTP verification attempts." });

router.post("/signup", signupLimiter, validate(signupSchema), signup);
router.post("/login", loginLimiter, validate(loginSchema), login);
router.patch("/change-password", authMiddleware, validate(changePasswordSchema), changePassword);
router.patch("/change-pin", authMiddleware, validate(changePinSchema), changePin);
router.post("/send-otp", otpLimiter, validate(sendOTPSchema), sendOTP);
router.post("/send-signup-otp", otpLimiter, validate(sendSignupOTPSchema), sendSignupOTP);
router.post("/forgot-password", otpLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", verifyOTPLimiter, validate(resetPasswordSchema), resetPassword);
router.post("/verify-otp", verifyOTPLimiter, validate(verifyOTPSchema), verifyOTP);
router.post("/refresh", validate(refreshSchema), refresh);
router.post("/logout", authMiddleware, validate(logoutSchema), logout);

module.exports = router;