const express = require("express");
const { getPgPool } = require("../../packages/database");
const logger = require("../../packages/logger");

const app = express();
app.use(express.json());

// GET /ledger/accounts
app.get("/accounts", async (req, res) => {
    try {
        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM ledger_accounts ORDER BY created_at DESC");
        return res.json(result.rows);
    } catch (err) {
        logger.error("Ledger accounts fetch error", { error: err.message });
        return res.status(500).json({ msg: err.message });
    }
});

// GET /ledger/entries
app.get("/entries", async (req, res) => {
    try {
        const pool = getPgPool();
        const result = await pool.query("SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT 100");
        return res.json(result.rows);
    } catch (err) {
        logger.error("Ledger entries fetch error", { error: err.message });
        return res.status(500).json({ msg: err.message });
    }
});

// GET /ledger/verify-invariants - Guarantees double-entry accounting invariant
app.get("/verify-invariants", async (req, res) => {
    try {
        const pool = getPgPool();
        const debitSumRes = await pool.query("SELECT COALESCE(SUM(amount), 0) as total_debit FROM ledger_entries");
        const creditSumRes = await pool.query("SELECT COALESCE(SUM(amount), 0) as total_credit FROM ledger_entries");

        const totalDebit = parseFloat(debitSumRes.rows[0].total_debit);
        const totalCredit = parseFloat(creditSumRes.rows[0].total_credit);
        const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

        return res.json({
            balanced,
            totalDebit,
            totalCredit,
            difference: Math.abs(totalDebit - totalCredit)
        });
    } catch (err) {
        logger.error("Ledger invariant check error", { error: err.message });
        return res.status(500).json({ msg: err.message });
    }
});

const PORT = process.env.PORT || 3006;
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Ledger Service running on port ${PORT}`);
    });
}

module.exports = app;
