const speakeasy = require("speakeasy");

const getUserSecret = (email) => {
    return Buffer
        .from(process.env.OTP_SECRET + email)
        .toString("base64");
};

const generateOTP = (email) => {
    return speakeasy.totp({
        secret: getUserSecret(email),
        encoding: "base64",
        step: 60,
        digits: 6
    });
};

const verifyOTP = (email, token) => {
    return speakeasy.totp.verify({
        secret: getUserSecret(email),
        encoding: "base64",
        token: token.toString(),
        step: 60,
        digits: 6,
        window: 1
    });
};

module.exports = { generateOTP, verifyOTP };