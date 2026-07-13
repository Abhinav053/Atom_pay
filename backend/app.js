require('dotenv').config();
const express=require("express");
const cors=require("cors")
const authRouter = require("./routes/auth.routes");
//const transactionRouter = require("./routes/transection.routes");
//const walletRouter = require("./routes/wallet.routes");
//const agentRouter = require("./routes/agent.routes");

const app=express();
app.set("trust proxy",1);


const allowedOrigins = (process.env.CORS_ORIGINS || "*").split(",").map(s => s.trim());
app.use(cors({
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"]
}));

app.use(express.json({limit:"100kb"}));// security ke liye:limit body size to prevent large-payload dos-

// ── Security: set essential security headers ──
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    next();
});

app.get("/", (req, res) => {
    res.status(200).json({
        msg: "AtomPay backend is running",
        api: "/api"
    });
});

app.get("/api",(req,res)=>{
    res.status(200).json({
        msg:"working properly",
         maintenance: process.env.MAINTENANCE_MODE === "true"
    })
})

//maintainance mode ke liye...

app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE === "true") {
        return res.status(503).json({
            msg: "AtomPay is currently under maintenance. We'll be back shortly!",
            maintenance: true
        });
    }
    next();
});


app.use("/api/auth", authRouter);
//app.use("/api/wallet", walletRouter);
//app.use("/api/transaction", transactionRouter);
//app.use("/api/agent", agentRouter);

app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({
        msg: err.message || "Internal server error"
    });
});

module.exports = app;
