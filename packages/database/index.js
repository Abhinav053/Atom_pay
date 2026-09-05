require("dotenv").config();
const { Pool } = require("pg");
const Redis = require("ioredis");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

let pgPool = null;
let redisClient = null;

// Initialize PostgreSQL Pool
function getPgPool() {
    if (!pgPool) {
        const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgres://postgres:postgres@localhost:5432/atompay";
        pgPool = new Pool({
            connectionString,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });

        pgPool.on("error", (err) => {
            console.error("[PostgreSQL] Unexpected pool error:", err.message);
        });
    }
    return pgPool;
}

// Auto-initialize PostgreSQL tables if needed (used for dev/testing)
async function initPgTables() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgres://postgres:postgres@localhost:5432/atompay";
    
    // Check if atompay database exists, create if missing
    try {
        const urlObj = new URL(connectionString);
        const dbName = urlObj.pathname.slice(1) || "atompay";
        const rootUrl = `${urlObj.protocol}//${urlObj.username}:${urlObj.password}@${urlObj.host}/postgres`;

        const rootPool = new Pool({ connectionString: rootUrl });
        const checkDb = await rootPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
        if (checkDb.rows.length === 0) {
            await rootPool.query(`CREATE DATABASE "${dbName}"`);
            console.log(`[PostgreSQL] Database "${dbName}" created automatically.`);
        }
        await rootPool.end();
    } catch (err) {
        // Ignore if database check fails or root connection not accessible
    }

    const pool = getPgPool();
    const initSqlPath = path.join(__dirname, "../../infrastructure/postgres/init.sql");
    if (fs.existsSync(initSqlPath)) {
        const sql = fs.readFileSync(initSqlPath, "utf8");
        await pool.query(sql);
    }
}

// Initialize Redis Client
function getRedis() {
    if (!redisClient) {
        const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        });

        redisClient.on("error", (err) => {
            console.error("[Redis] Error:", err.message);
        });
    }
    return redisClient;
}

function createBullConnection() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    return new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    });
}

// Initialize MongoDB Connection
async function connectMongoDB() {
    if (mongoose.connection.readyState === 0) {
        const mongoUrl = process.env.MONGO_URL || "mongodb://localhost:27017/atompay";
        await mongoose.connect(mongoUrl, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
    }
    return mongoose.connection;
}

module.exports = {
    getPgPool,
    initPgTables,
    getRedis,
    createBullConnection,
    connectMongoDB
};
