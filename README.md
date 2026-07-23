# AtomPay Backend

This README documents the AtomPay backend service located in `backend/`.
It explains the architecture, dependencies, environment configuration, available APIs, and the runtime workflow for authentication, wallet management, transfers, top-ups, and payment webhooks.

---

## Overview

AtomPay is a Node.js backend built with Express, MongoDB, Redis, and BullMQ. It provides a digital wallet service where users can:

- register, login, and manage authentication
- send and receive money using username-based transfers
- top up wallet balance through a mock payment gateway
- verify and manage OTP-based actions
- fetch wallet balances, transaction history, and QR code data

The backend uses:

- `express` for HTTP routing
- `mongoose` for MongoDB models and transactions
- `ioredis` for Redis caching and queue support
- `bullmq` for background workers
- `jsonwebtoken` for JWT authentication
- `zod` for request validation
- `speakeasy` for one-time password generation
- `sib-api-v3-sdk` for email delivery

---

## Architecture

### Main components

- `app.js` - configures Express, security headers, CORS, maintenance mode, and routes.
- `index.js` - starts the API server, connects to MongoDB, and warms Redis.
- `worker.js` - starts background queue workers for email, audit logs, and payment processing.
- `controllers/` - request handlers for auth, payment, wallet, transaction, and webhook logic.
- `services/` - business logic for payment gateway simulation and webhook processing.
- `db/` - Mongoose models and Redis connections.
- `middlewares/` - auth, validation, rate limiting, and idempotency support.
- `queues/` - BullMQ producers for jobs.
- `workers/` - asynchronous workers that process email, audit, and payment tasks.

### Data flow

1. HTTP request arrives at `app.js`.
2. request validation and authentication happen in middleware.
3. controller logic executes business rules.
4. data is persisted in MongoDB via models.
5. Redis is used for caching wallet balance and transaction read results.
6. non-critical tasks are queued using BullMQ and processed by separate workers.

---

## Environment Setup

Create a `.env` file in `backend/` with these variables:

- `PORT` - backend HTTP port (default: `3000`)
- `MONGO_URL` - MongoDB connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - secret key for signing JWT tokens
- `OTP_SECRET` - secret used to derive OTP seed values
- `BREVO_API_KEY` - Sendinblue/Brevo transactional email API key
- `PAYMENT_WEBHOOK_URL` - optional URL for the mock gateway to post payment results
- `PAYMENT_WEBHOOK_SECRET` - webhook signature secret
- `CORS_ORIGINS` - comma-separated allowed origins
- `MAINTENANCE_MODE` - set to `true` to enable maintenance blocking

Example:

```env
PORT=3000
MONGO_URL=mongodb://localhost:27017/atompay
REDIS_URL=redis://localhost:6379
JWT_SECRET=supersecret
OTP_SECRET=otpsecret
BREVO_API_KEY=your-brevo-api-key
PAYMENT_WEBHOOK_SECRET=paymentsecret
CORS_ORIGINS=* 
MAINTENANCE_MODE=false
```

> The backend will fail to start if `MONGO_URL` or `REDIS_URL` are missing.

---

## Installation

From `backend/` run:

```bash
npm install
```

Then start the API server:

```bash
npm start
```

Start queue workers in a separate terminal:

```bash
npm run start:worker
```

For syntax checking only:

```bash
npm run check
```

---

## API Endpoints

### Authentication

Base route: `/api/auth`

- `POST /signup` - register a new user with OTP verification and a PIN.
- `POST /login` - login with email and password.
- `PATCH /change-password` - change user password (authenticated).
- `PATCH /change-pin` - change 6-digit wallet PIN (authenticated).
- `POST /send-otp` - send OTP to email after password verification.
- `POST /send-signup-otp` - send signup OTP before creating an account.
- `POST /forgot-password` - request password reset OTP.
- `POST /reset-password` - reset password with OTP.
- `POST /verify-otp` - verify an OTP for an email.
- `POST /refresh` - refresh authentication tokens.
- `POST /logout` - revoke access for authenticated users.

### Wallet

Base route: `/api/wallet`

- `GET /` or `/me` or `/balance` - get current wallet balance, currency, status, and QR code.
- `GET /transactions` - get recent transactions for the authenticated wallet.
- `POST /topup` - request a wallet top-up via the payment gateway.

### Transfers

Base route: `/api/transaction`

- `POST /transfer` - transfer money to another user by username.

### Webhook

- `POST /api/webhook/payment` - receive payment gateway webhook callbacks.
- `POST /webhook/payment` - alternate public webhook path.

---

## Workflow Details

### 1. Signup and account creation

1. User requests `POST /api/auth/send-signup-otp` with email.
2. Backend validates email uniqueness and sends a 6-digit OTP by email.
3. User submits `POST /api/auth/signup` with name, username, email, password, 6-digit PIN, and OTP.
4. Backend verifies the OTP, hashes password/PIN, creates a new `User`, creates a `Wallet`, and returns JWT tokens.
5. New wallets are created with a default balance and a QR code payload generated from the user username.

### 2. Login and authentication

1. User sends `POST /api/auth/login` with email and password.
2. Backend verifies credentials and issues an access token and refresh token.
3. Access token must be sent in `Authorization: Bearer <token>` for protected routes.

### 3. OTP operations

- `send-otp`: verifies the user password, then sends a time-based OTP to the registered email.
- `verify-otp`: checks OTP validity using a per-email secret plus the shared OTP secret.
- `forgot-password` / `reset-password`: password recovery is protected with OTP verification.

### 4. Wallet reads and caching

- `GET /api/wallet` reads the wallet and caches balance/results in Redis.
- `GET /api/wallet/transactions` returns recent transactions and caches them.
- Cached data is invalidated after transfers or payment webhook events to keep balances accurate.

### 5. Top-up workflow

1. Authenticated users call `POST /api/wallet/topup` with `amount`.
2. Backend creates a `Payment` record in MongoDB with status `PENDING`.
3. A payment job is enqueued in BullMQ for asynchronous processing.
4. The payment worker simulates gateway processing and posts a signed webhook to `/api/webhook/payment`.
5. Webhook processing verifies the signature, updates the payment status, credits the wallet on success, records a transaction, and invalidates cache.

### 6. Transfer workflow

1. User calls `POST /api/transaction/transfer` with `receiverUsername`, `amount`, `pin`, and optional `note`.
2. Auth middleware validates the JWT token.
3. Rate limiting and idempotency protections apply.
4. Backend verifies sender and receiver status, wallet state, PIN, and daily velocity cap.
5. A MongoDB transaction atomically debits sender wallet and credits receiver wallet.
6. On success, cached balances and transaction history are invalidated.
7. Non-critical tasks are enqueued for email notification and audit logging.

---

## Security and protections

- JWT authentication using `Authorization: Bearer <token>`.
- Rate limiting on signup, login, OTP, and transfer endpoints.
- Maintenance mode blocks requests when `MAINTENANCE_MODE=true`.
- Input validation with `zod` for all request bodies.
- Secure headers are applied globally in `app.js`.
- OTP codes are time-based and expire after a short window.
- Wallet transfers are guarded by PIN verification and daily spend caps.
- Webhook signatures are verified using `PAYMENT_WEBHOOK_SECRET`.

---

## Important files

- `app.js` — main Express application and routes
- `index.js` — API server entrypoint
- `worker.js` — background worker process entrypoint
- `controllers/` — endpoint handlers
- `services/` — payment and webhook business logic
- `db/` — MongoDB schemas and Redis helpers
- `middlewares/` — auth, validation, rate limiting, idempotency
- `queues/` — BullMQ producers
- `workers/` — email, audit, and payment workers

---

## How to run

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Start the API server:
   ```bash
   npm start
   ```
3. In another terminal, start the worker process:
   ```bash
   npm run start:worker
   ```
4. Use a REST client to call the endpoints above.

---

## Notes

- The payment gateway is currently mocked, so real payment provider integration is not included.
- The backend uses Redis both for caching and BullMQ queueing.
- The project is designed to keep request latency low by moving email/audit work off the request path.
- Refresh tokens are persisted in MongoDB and can be revoked when passwords change.

---

## Future improvements

- Add explicit logout token revocation via refresh token endpoint.
- Add wallet freeze/unfreeze and account admin controls.
- Add stronger webhook event replay protection beyond Redis key reservation.
- Add transaction pagination and filtering for `/api/wallet/transactions`.
- Add end-to-end tests and API documentation.
