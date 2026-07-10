const mongoose = require("mongoose");
const walletSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true

    },
    balance: {
        type: Number,
        min: 0,
        default: 500000
    },
    currency: {
        type: String,
        enum: ["INR"],
        default: "INR"
    },
    status: {
        type: String,
        enum: ["Active", "Frozen", "Closed"],
        default: "Active"
    },
    qrCode: {
        type: String,
        default: ""
    }
}, { timestamps: true });
const wallet = mongoose.model("Wallet", walletSchema);
module.exports = wallet;