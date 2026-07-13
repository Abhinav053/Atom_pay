const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../db/user");
const Wallet = require("../db/wallet");

const signToken = (user) => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not set");
    }

    return jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );
};

const signup = async (req, res, next) => {
    try {
        const { name, email, username, password, pin } = req.body;

        if (!name || !email || !username || !password || !pin) {
            return res.status(400).json({
                msg: "name, email, username, password, and pin are required"
            });
        }

        if (String(password).length < 6) {
            return res.status(400).json({ msg: "Password must be at least 6 characters" });
        }

        if (!/^\d{4,6}$/.test(String(pin))) {
            return res.status(400).json({ msg: "PIN must be 4 to 6 digits" });
        }

        const existingUser = await User.findOne({
            $or: [
                { email: String(email).toLowerCase().trim() },
                { username: String(username).toLowerCase().trim() }
            ]
        });

        if (existingUser) {
            return res.status(409).json({ msg: "Email or username already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const hashedPin = await bcrypt.hash(String(pin), 10);

        const user = await User.create({
            name,
            email,
            username,
            password: hashedPassword,
            hashedPin
        });

        await Wallet.create({ user: user._id });

        const token = signToken(user);

        return res.status(201).json({
            msg: "Signup successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        next(err);
    }
};

const login = async (req, res, next) => {
    try {
        const { email, username, password } = req.body;
        const identifier = email || username;

        if (!identifier || !password) {
            return res.status(400).json({
                msg: "email or username and password are required"
            });
        }

        const user = await User.findOne({
            $or: [
                { email: String(identifier).toLowerCase().trim() },
                { username: String(identifier).toLowerCase().trim() }
            ]
        }).select("+password");

        if (!user) {
            return res.status(401).json({ msg: "Invalid credentials" });
        }

        if (!user.active) {
            return res.status(403).json({ msg: "Account is inactive" });
        }

        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ msg: "Invalid credentials" });
        }

        const token = signToken(user);

        return res.status(200).json({
            msg: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        next(err);
    }
};

module.exports = { signup, login };
