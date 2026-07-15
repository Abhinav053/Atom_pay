const jwt = require("jsonwebtoken");
const authMiddleware = (req, res, next) => {
  console.log("iside auth")
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    // FIX: Use "msg" consistently (was "message" — mismatched with all controllers)
     
    return res.status(401).json({ msg: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
   
    req.user = {
      id: decoded.userId
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        msg: "Token expired, please login again"
      });
    }
    // FIX: Use "msg" consistently (was "message")
    return res.status(403).json({ msg: "Invalid token" });
  }
}

module.exports = authMiddleware;