const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-atompay";

/**
 * Local JWT Verification Middleware
 * Verifies access token locally using JWT_SECRET without calling Auth service network.
 * Attaches user ID to `req.user` and forwards `x-user-id` header to internal microservices.
 */
function verifyJWT(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ msg: "Unauthorized: Missing or invalid token format" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.headers["x-user-id"] = decoded.id;
        return next();
    } catch (err) {
        return res.status(401).json({ msg: "Unauthorized: Invalid or expired token" });
    }
}

module.exports = verifyJWT;
