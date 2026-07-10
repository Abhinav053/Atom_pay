require('dotenv').config();
const mongoose = require("mongoose");
const connectDB = require("./db/db");
const app = require("./app");


const PORT = process.env.PORT || 3000;

const startServer = async () => {
    if (!process.env.MONGO_URL) throw new Error('Mongo url required');
    await connectDB();
  //  getRedis(); // pre-warm the Redis connection at boot, not on first request

    const server = app.listen(PORT, () => {
        console.log(`server running on port ${PORT} ✅`);
    });

    // Graceful shutdown: stop accepting new requests, let in-flight ones finish,
    // then close DB / Redis / queue connections.
   
};
startServer();