const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
    event: { type: String, required: true },
    transactionId: String,
    fromUserId: String,
    toUserId: String,
    amount: Number,
    status: String,
    failureReason: String
}, { timestamps: true });

module.exports = mongoose.model("AuditLog", auditLogSchema);