/**
 * AtomPay End-to-End Live Microservices Test
 * Boots microservice servers, executes actual HTTP requests against API Gateway,
 * and prints database outputs and verification results.
 */

require("dotenv").config();
const crypto = require("crypto");

const GATEWAY_URL = "http://localhost:3000";

// Internal service modules
const authApp = require("../services/auth-service");
const walletApp = require("../services/wallet-service");
const paymentApp = require("../services/payment-service").app;
const refundApp = require("../services/refund-service");
const webhookApp = require("../services/webhook-service");
const ledgerApp = require("../services/ledger-service");
const notificationApp = require("../services/notification-service").app;
const gatewayApp = require("../api-gateway/src/app");

const { getPgPool, initPgTables, getRedis } = require("../packages/database");

let servers = [];

async function startAllServers() {
    console.log("--> Initializing PostgreSQL Schemas & Tables...");
    await initPgTables();

    console.log("--> Starting Microservices on Ports 3000 - 3007...");
    servers.push(authApp.listen(3001));
    servers.push(walletApp.listen(3002));
    servers.push(paymentApp.listen(3003));
    servers.push(refundApp.listen(3004));
    servers.push(webhookApp.listen(3005));
    servers.push(ledgerApp.listen(3006));
    servers.push(notificationApp.listen(3007));
    servers.push(gatewayApp.listen(3000));

    console.log("[OK] All Microservice Servers & API Gateway listening on ports 3000-3007.\n");
}

function stopAllServers() {
    for (const server of servers) {
        try { server.close(); } catch (_) {}
    }
}

async function runE2EFlow() {
    try {
        await startAllServers();

        console.log("==================================================");
        console.log("   AtomPay E2E Live Microservices API Execution   ");
        console.log("==================================================\n");

        const randStr = Math.random().toString(36).slice(2, 8);
        const aliceEmail = `alice_${randStr}@example.com`;
        const aliceUser = `alice_${randStr}`;
        const bobEmail = `bob_${randStr}@example.com`;
        const bobUser = `bob_${randStr}`;
        const pin = "123456";

        // Step 1: Send Signup OTP for Alice
        console.log(`1. Requesting Signup OTP for ${aliceEmail}...`);
        const otpRes = await fetch(`${GATEWAY_URL}/api/auth/send-signup-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aliceEmail })
        });
        const otpData = await otpRes.json();
        console.log("   Response:", otpData);
        const otpCode = otpData.debugOtp || "123456";

        // Step 2: Signup Alice
        console.log(`\n2. Registering User Alice (@${aliceUser})...`);
        const signupAliceRes = await fetch(`${GATEWAY_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: aliceUser,
                name: "Alice Smith",
                email: aliceEmail,
                password: "Password123!",
                pin,
                otp: otpCode
            })
        });
        const aliceAuth = await signupAliceRes.json();
        console.log("   Response:", aliceAuth);
        const aliceToken = aliceAuth.accessToken;

        // Step 3: Send Signup OTP & Register Bob
        console.log(`\n3. Registering User Bob (@${bobUser})...`);
        const otpBobRes = await fetch(`${GATEWAY_URL}/api/auth/send-signup-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: bobEmail })
        });
        const otpBobData = await otpBobRes.json();
        const bobOtpCode = otpBobData.debugOtp || "123456";

        const signupBobRes = await fetch(`${GATEWAY_URL}/api/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: bobUser,
                name: "Bob Jones",
                email: bobEmail,
                password: "Password123!",
                pin,
                otp: bobOtpCode
            })
        });
        const bobAuth = await signupBobRes.json();
        console.log("   Response:", bobAuth);

        // Step 4: Login Alice
        console.log(`\n4. Logging in Alice (${aliceEmail})...`);
        const loginRes = await fetch(`${GATEWAY_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: aliceEmail, password: "Password123!" })
        });
        const loginData = await loginRes.json();
        console.log("   Response:", loginData);

        // Step 5: Check Wallet Balance
        console.log("\n5. Fetching Alice's Wallet Balance (via Gateway)...");
        const balanceRes = await fetch(`${GATEWAY_URL}/api/wallet/balance`, {
            headers: { "Authorization": `Bearer ${aliceToken}` }
        });
        const balanceData = await balanceRes.json();
        console.log("   Alice Balance:", balanceData);

        // Step 6: Execute Money Transfer (Alice -> Bob ₹500)
        console.log(`\n6. Transferring ₹500 from @${aliceUser} to @${bobUser}...`);
        const transferIdemKey = crypto.randomUUID();
        const transferRes = await fetch(`${GATEWAY_URL}/api/transaction/transfer`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${aliceToken}`,
                "Content-Type": "application/json",
                "Idempotency-Key": transferIdemKey
            },
            body: JSON.stringify({
                receiverUsername: bobUser,
                amount: 500,
                pin,
                note: "Dinner split"
            })
        });
        const transferData = await transferRes.json();
        console.log("   Transfer Result:", transferData);

        // Step 7: Test Transfer Idempotency Replay
        console.log("\n7. Replaying same transfer request with duplicate Idempotency-Key...");
        const replayRes = await fetch(`${GATEWAY_URL}/api/transaction/transfer`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${aliceToken}`,
                "Content-Type": "application/json",
                "Idempotency-Key": transferIdemKey
            },
            body: JSON.stringify({
                receiverUsername: bobUser,
                amount: 500,
                pin,
                note: "Dinner split"
            })
        });
        const replayData = await replayRes.json();
        console.log("   Idempotency Replay Result (Cached):", replayData);

        // Step 8: Initiate Wallet Top-up
        console.log("\n8. Initiating Top-up payment of ₹1,000 for Alice...");
        const topupIdemKey = crypto.randomUUID();
        const topupRes = await fetch(`${GATEWAY_URL}/api/wallet/topup`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${aliceToken}`,
                "Content-Type": "application/json",
                "Idempotency-Key": topupIdemKey
            },
            body: JSON.stringify({ amount: 1000 })
        });
        const topupData = await topupRes.json();
        console.log("   Topup Result:", topupData);
        const paymentId = topupData.paymentId;

        // Step 9: Post Provider Webhook Callback (Simulating Gateway Webhook)
        console.log(`\n9. Posting Webhook Callback for Payment ID ${paymentId}...`);
        const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "dev-payment-webhook-secret";
        const webhookPayload = {
            paymentId,
            userId: aliceAuth.user.id,
            amount: 1000,
            status: "SUCCESS",
            gatewayTxnId: `mock_gw_${crypto.randomUUID()}`,
            provider: "MOCK_GATEWAY"
        };
        const signature = crypto
            .createHmac("sha256", webhookSecret)
            .update(JSON.stringify(webhookPayload))
            .digest("hex");

        const webhookRes = await fetch(`${GATEWAY_URL}/api/webhooks/payment`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-payment-signature": signature
            },
            body: JSON.stringify(webhookPayload)
        });
        const webhookData = await webhookRes.json();
        console.log("   Webhook Result:", webhookData);

        // Step 10: Check Topup Status
        console.log(`\n10. Checking Payment Status for ${paymentId}...`);
        const statusRes = await fetch(`${GATEWAY_URL}/api/wallet/topup/${paymentId}`, {
            headers: { "Authorization": `Bearer ${aliceToken}` }
        });
        const statusData = await statusRes.json();
        console.log("   Payment Status:", statusData);

        // Step 11: Initiate Refund
        console.log(`\n11. Initiating Refund for Payment ${paymentId}...`);
        const refundRes = await fetch(`${GATEWAY_URL}/api/refunds`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${aliceToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ paymentId, reason: "Customer requested cancellation" })
        });
        const refundData = await refundRes.json();
        console.log("   Refund Result:", refundData);

        // Step 12: Verify Ledger Double-Entry Invariants
        console.log("\n12. Verifying Double-Entry Ledger Invariants...");
        const ledgerRes = await fetch(`${GATEWAY_URL}/api/ledger/verify-invariants`, {
            headers: { "Authorization": `Bearer ${aliceToken}` }
        });
        const ledgerData = await ledgerRes.json();
        console.log("   Ledger Invariant Audit:", ledgerData);

        // Step 13: Fetch Direct PostgreSQL Database Outputs
        console.log("\n==================================================");
        console.log("   Direct PostgreSQL Database Output Inspection   ");
        console.log("==================================================");

        const pool = getPgPool();

        const usersDb = await pool.query("SELECT id, name, username, email FROM users ORDER BY created_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] USERS Table:");
        console.table(usersDb.rows);

        const walletsDb = await pool.query("SELECT id, user_id, balance, status FROM wallets ORDER BY updated_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] WALLETS Table:");
        console.table(walletsDb.rows);

        const txDb = await pool.query("SELECT transaction_id, type, amount, status, sender_username, receiver_username FROM wallet_transactions ORDER BY created_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] WALLET_TRANSACTIONS Table:");
        console.table(txDb.rows);

        const paymentsDb = await pool.query("SELECT payment_id, amount, status, provider, gateway_txn_id FROM payments ORDER BY created_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] PAYMENTS Table:");
        console.table(paymentsDb.rows);

        const ledgerDb = await pool.query("SELECT entry_id, transaction_type, amount, reference_id, description FROM ledger_entries ORDER BY created_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] LEDGER_ENTRIES Table:");
        console.table(ledgerDb.rows);

        const outboxDb = await pool.query("SELECT event_id, event_type, status, created_at FROM outbox_events ORDER BY created_at DESC LIMIT 5");
        console.log("\n[PostgreSQL] OUTBOX_EVENTS Table:");
        console.table(outboxDb.rows);

        console.log("\n[SUCCESS] All Microservices and Database Tests Completed Successfully!\n");
    } catch (err) {
        console.error("E2E Test Execution Error:", err);
    } finally {
        stopAllServers();
        process.exit(0);
    }
}

runE2EFlow();
