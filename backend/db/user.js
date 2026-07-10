const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 2
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        minlength: 3
    }, hashedPin: {
        type: String,
        required: true,
        select: false,
    },
    active: {
        type: Boolean,
        default: true
    },
    role: {
        type: String,
        enum: ["User", "admin"],
        default: "User"
    }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
module.exports = User