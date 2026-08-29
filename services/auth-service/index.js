const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { getPgPool, getRedis } = require("../../packages/database");
const logger = require("../../packages/logger");

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-atompay";
const ACCESS_TOKEN_EXPIRE = "15m";
const REFRESH_TOKEN_EXPIRE_DAYS = 7;

// JWT Token Generation
function generateAccessToken(userId) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRE });
}

async function generateTokenPair(userId) {
    const accessToken = generateAccessToken(userId);
    const refreshToken = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    const pool = getPgPool();
    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
        [userId, refreshToken, expiresAt]
    );

    return { accessToken, refreshToken };
}

// Helper: OTP Generation & Verification
async function generateAndStoreOTP(email) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const redis = getRedis();
    // Store in Redis for 10 minutes
    await redis.set(`otp:${email}`, otp, "EX", 600);
    return otp;
}

async function verifyOTP(email, otp) {
    const redis = getRedis();
    const stored = await redis.get(`otp:${email}`);
    if (stored && stored === otp) {
        await redis.del(`otp:${email}`);
        return true;
    }
    return false;
}

// ── Auth Endpoints ──

// Signup
app.post("/signup", async (req, res) => {
    try {
        const { username, name, email, password, pin, otp } = req.body;
        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ msg: "Invalid PIN entered" });
        }

        const validOtp = await verifyOTP(email, otp);
        if (!validOtp) {
            return res.status(400).json({ msg: "Wrong or expired OTP" });
        }

        const pool = getPgPool();
        // Check existing user
        const existing = await pool.query(
            "SELECT id FROM users WHERE email = $1 OR username = $2",
            [email, username]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ msg: "Email or username already exists" });
        }

        const hashedPass = await bcrypt.hash(password, 10);
        const hashedPin = await bcrypt.hash(pin, 10);
        const qrData = `atompay://pay?to=${username}`;
        const qrBase64 = await QRCode.toDataURL(qrData);

        const client = await pool.connect();
        let newUser;
        try {
            await client.query("BEGIN");
            const userRes = await client.query(
                `INSERT INTO users (name, email, username, password, hashed_pin)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id, name, username`,
                [name, email, username, hashedPass, hashedPin]
            );
            newUser = userRes.rows[0];

            // Create initial wallet
            const walletRes = await client.query(
                `INSERT INTO wallets (user_id, balance, currency, status, qr_code)
                 VALUES ($1, 5000.00, 'INR', 'Active', $2) RETURNING id`,
                [newUser.id, qrBase64]
            );

            // Create initial ledger account for user
            await client.query(
                `INSERT INTO ledger_accounts (account_number, account_type, user_id, currency)
                 VALUES ($1, 'CUSTOMER_WALLET', $2, 'INR')`,
                [`ACC_${newUser.id}`, newUser.id]
            );

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        const tokens = await generateTokenPair(newUser.id);
        return res.json({
            msg: "Signup Successful with signup bonus of ₹5000",
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: { id: newUser.id, name: newUser.name, username: newUser.username }
        });
    } catch (err) {
        logger.error("Signup error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Login
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: "User does not exist" });
        }
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ msg: "Wrong password" });
        }

        const tokens = await generateTokenPair(user.id);
        return res.json({
            msg: "Login successful",
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: { id: user.id, name: user.name, username: user.username, role: user.role }
        });
    } catch (err) {
        logger.error("Login error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Send Signup OTP
app.post("/send-signup-otp", async (req, res) => {
    try {
        const { email } = req.body;
        const pool = getPgPool();
        const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ msg: "Email already exists" });
        }
        const otp = await generateAndStoreOTP(email);
        logger.info("Generated signup OTP", { email, otp });
        return res.status(200).json({ msg: "OTP sent to your email for signup", debugOtp: otp });
    } catch (err) {
        logger.error("Send signup OTP error", { error: err.message });
        return res.status(500).json({ msg: "Failed to send OTP. Please try again." });
    }
});

// Send OTP
app.post("/send-otp", async (req, res) => {
    try {
        const { email, password } = req.body;
        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) return res.status(404).json({ msg: "User not found" });

        const isMatch = await bcrypt.compare(password, result.rows[0].password);
        if (!isMatch) return res.status(401).json({ msg: "Wrong password" });

        const otp = await generateAndStoreOTP(email);
        return res.status(200).json({ msg: "OTP sent to your email", debugOtp: otp });
    } catch (err) {
        logger.error("Send OTP error", { error: err.message });
        return res.status(500).json({ msg: "Failed to send OTP. Please try again." });
    }
});

// Forgot Password
app.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        const pool = getPgPool();
        const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (result.rows.length > 0) {
            await generateAndStoreOTP(email);
        }
        return res.status(200).json({
            msg: "If an account exists for this email, a password reset OTP has been sent."
        });
    } catch (err) {
        logger.error("Forgot password error", { error: err.message });
        return res.status(500).json({ msg: "Failed to send OTP. Please try again." });
    }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const valid = await verifyOTP(email, otp);
        if (!valid) return res.status(400).json({ msg: "Wrong or expired OTP" });

        const pool = getPgPool();
        const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ msg: "User not found" });

        const userId = userRes.rows[0].id;
        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [hashed, userId]);
        await pool.query("UPDATE refresh_tokens SET revoked = true WHERE user_id = $1", [userId]);

        return res.status(200).json({ msg: "Password reset successfully. Please log in with your new password." });
    } catch (err) {
        logger.error("Reset password error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Verify OTP
app.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        const valid = await verifyOTP(email, otp);
        if (!valid) return res.status(400).json({ msg: "Wrong or expired OTP" });

        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) return res.status(404).json({ msg: "User not found" });

        const user = result.rows[0];
        const tokens = await generateTokenPair(user.id);

        return res.status(200).json({
            msg: "Login successful",
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: { id: user.id, name: user.name, username: user.username, role: user.role }
        });
    } catch (err) {
        logger.error("Verify OTP error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Refresh Token
app.post("/refresh", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ msg: "Refresh token required" });

        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM refresh_tokens WHERE token = $1", [refreshToken]);
        if (result.rows.length === 0) return res.status(401).json({ msg: "Invalid refresh token" });

        const tokenDoc = result.rows[0];
        if (tokenDoc.revoked) return res.status(401).json({ msg: "Refresh token has been revoked" });
        if (new Date(tokenDoc.expires_at) < new Date()) return res.status(401).json({ msg: "Refresh token expired" });

        const accessToken = generateAccessToken(tokenDoc.user_id);
        return res.status(200).json({ accessToken });
    } catch (err) {
        logger.error("Refresh error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Logout
app.post("/logout", async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            const pool = getPgPool();
            await pool.query("UPDATE refresh_tokens SET revoked = true WHERE token = $1", [refreshToken]);
        }
        return res.status(200).json({ msg: "Logged out successfully" });
    } catch (err) {
        logger.error("Logout error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Change Password
app.patch("/change-password", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const { oldPassword, newPassword } = req.body;
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
        if (result.rows.length === 0) return res.status(404).json({ msg: "User not found" });

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ msg: "Wrong Password Entered" });

        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [hashed, userId]);
        await pool.query("UPDATE refresh_tokens SET revoked = true WHERE user_id = $1", [userId]);

        return res.status(200).json({ msg: "Password changed successfully" });
    } catch (err) {
        logger.error("Change password error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

// Change PIN
app.patch("/change-pin", async (req, res) => {
    try {
        const userId = req.headers["x-user-id"];
        const { oldPin, newPin } = req.body;
        if (!userId) return res.status(401).json({ msg: "Unauthorized" });

        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
        if (result.rows.length === 0) return res.status(404).json({ msg: "User Not Found" });

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(oldPin, user.hashed_pin);
        if (!isMatch) return res.status(401).json({ msg: "Incorrect PIN entered" });

        const hashedPin = await bcrypt.hash(newPin, 10);
        await pool.query("UPDATE users SET hashed_pin = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [hashedPin, userId]);

        return res.status(200).json({ msg: "Pin changed successfully" });
    } catch (err) {
        logger.error("Change pin error", { error: err.message });
        return res.status(500).json({ msg: "An unexpected error occurred. Please try again." });
    }
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Auth Service running on port ${PORT}`);
    });
}

module.exports = app;
