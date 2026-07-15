const zod = require("zod");

exports.signupSchema = zod.object({
    name: zod.string().min(1).max(50).trim(),
    email: zod.string().email(),
    password: zod.string().min(8).max(32),
    username: zod.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
    pin: zod.string().regex(/^\d{6}$/),
    otp: zod.string().length(6)
})

exports.loginSchema = zod.object({
    email: zod.string().email(),
    password: zod.string().min(8)
})

exports.changePasswordSchema = zod.object({
    oldPassword: zod.string().min(1),
    newPassword: zod.string().min(8).max(32)
})

exports.changePinSchema = zod.object({
    oldPin: zod.string().regex(/^\d{6}$/),
    newPin: zod.string().regex(/^\d{6}$/)
})

exports.sendOTPSchema = zod.object({
    email: zod.string().email(),
    password: zod.string().min(1)
});

exports.sendSignupOTPSchema = zod.object({
    email: zod.string().email()
});

exports.forgotPasswordSchema = zod.object({
    email: zod.string().email()
});

exports.resetPasswordSchema = zod.object({
    email: zod.string().email(),
    otp: zod.string().length(6),
    newPassword: zod.string().min(8).max(32)
});

exports.verifyOTPSchema = zod.object({
    email: zod.string().email(),
    otp: zod.string().length(6)
});

exports.refreshSchema = zod.object({
    refreshToken: zod.string().min(1)
});

exports.logoutSchema = zod.object({
    refreshToken: zod.string().min(1).optional()
});