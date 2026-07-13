require('dotenv').config();
const mongoose = require("mongoose");
const connectDB = require("./db/db");
const app = require("./app");
const { getRedis, closeRedis } = require("./db/redis");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    if (!process.env.MONGO_URL) throw new Error('Mongo url required');
    await connectDB();
    getRedis(); // pre-warm the Redis connection at boot, not on first request

    const server = app.listen(PORT, () => {
         console.log(`Server is listening on port http://localhost:${PORT}`);
    });

    // Graceful shutdown: stop accepting new requests, let in-flight ones finish,
    // then close DB / Redis / queue connections.
   
};
startServer().catch((err) => {
    console.error("Server failed to start:", err.message);
    process.exit(1);
});
