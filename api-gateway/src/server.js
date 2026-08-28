require("dotenv").config();
const app = require("./app");
const logger = require("../../packages/logger");
const { initPgTables } = require("../../packages/database");

const PORT = process.env.PORT || 3000;

async function startGateway() {
    try {
        await initPgTables();
        app.listen(PORT, () => {
            logger.info(`AtomPay API Gateway listening on port http://localhost:${PORT}`);
        });
    } catch (err) {
        logger.error("Failed to start API Gateway", { error: err.message });
        process.exit(1);
    }
}

startGateway();
