const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const RefreshToken = require("../db/refreshToken");

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

const generateAccessToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "15m" });
};

const generateRefreshToken = async (userId) => {
    const token = crypto.randomBytes(64).toString("hex");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    
    await RefreshToken.create({
        token,
        user: userId,
        expiresAt
    });

    return token;
};

const generateTokenPair = async (userId) => {
    const accessToken = generateAccessToken(userId);
    const refreshToken = await generateRefreshToken(userId);
    return { accessToken, refreshToken };
};

const revokeRefreshToken = async (token) => {
    await RefreshToken.findOneAndUpdate(
        { token },
        { revoked: true }
    );
};

const revokeAllUserTokens = async (userId) => {
    await RefreshToken.updateMany(
        { user: userId, revoked: false },
        { revoked: true }
    );
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    generateTokenPair,
    revokeRefreshToken,
    revokeAllUserTokens
};