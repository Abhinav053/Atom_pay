const express = require("express");
const { signup, login } = require("../controllers/auth.controller");

const router = express.Router();

router.get("/", (req, res) => {
    res.status(200).json({ msg: "Auth routes working" });
});

router.post("/signup", signup);
router.post("/login", login);

module.exports = router;
