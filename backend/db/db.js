const mongoose = require("mongoose");
const connectDB = async () => {
    try {
        // Strict connection pool — reuse a bounded set of sockets instead of
        // opening connections per request.
        console.log("hi")
        await mongoose.connect(process.env.MONGO_URL, {
            maxPoolSize: 10,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log("DB connected successfully");
    } catch (err) {
        console.log(err);
        process.exit(1); // if failed to connect to server so exit the process
    }
};
module.exports = connectDB;