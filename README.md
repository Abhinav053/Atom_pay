# AtomPay — Event-Driven Microservices Backend Architecture

![Node](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Financial_Store-4169E1?logo=postgresql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Audit_Events-47A248?logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-BullMQ_Coordination-DC382D?logo=redis&logoColor=white)
![Architecture](https://img.shields.io/badge/Architecture-Event--Driven_Microservices-purple)

> **"Jab paise hawa mein hote hain, 'hope' is not an acceptable architecture."**

AtomPay is a production-grade, event-driven microservices digital wallet and payment processing backend. The system features database per service isolation with PostgreSQL as the financial source of truth, MongoDB as an audit event store, Redis for distributed locks and rate-limiting, a Transactional Outbox pattern for message reliability, BullMQ queues, Double-Entry Accounting Ledger, Opossum Circuit Breakers, Webhook Deduplication, and an Automated Reconciliation Engine.

---

## 🏗 Target Microservices Architecture

```text
                                CLIENT
                                   |
                                   v
                           +---------------+
                           |  API GATEWAY  |
                           +-------+-------+
                                   |
         +-------------------------+-------------------------+
         |                         |                         |
         v                         v                         v
   AUTH SERVICE              WALLET SERVICE            PAYMENT SERVICE
         |                         |                         |
         v                         v                         v
    PostgreSQL                PostgreSQL                PostgreSQL
                                                              |
                                                              v
                                                     Transactional Outbox
                                                              |
                                                              v
                                                     BullMQ / Message Broker
                                                              |
                  +-------------------------------------------+----------------+
                  |                                           |                |
                  v                                           v                v
            Payment Worker                              Ledger Service   Notification
                  |                                           |                Service
                  v                                           v
            Circuit Breaker                              PostgreSQL
                  |
                  v
            Provider Adapter
                  |
         +--------+---------+
         |                  |
         v                  v
     Provider A         Provider B
         |
         v
     Payment Gateway
         |
         v
    Webhook Service
         |
         v
      MongoDB
         |
         v
     Event / Queue
         |
         v
  Payment Status Handler
         |
     State Machine
         |
     +---+---+
     |       |
     v       v
  SUCCESS  FAILED
     |
     v
  Ledger
```

---

## 🏛 Database Ownership & Data Boundaries

To prevent "God Database" antipatterns, services strictly own their databases and domain logic. Services communicate exclusively via REST APIs or asynchronous domain events.

| Storage Engine | Service Owner | Owned Entities / Tables | Responsibility |
|---|---|---|---|
| **PostgreSQL** | Auth Service | `users`, `refresh_tokens`, `otp_codes` | Durable user credentials, bcrypt password/PIN hashes, tokens |
| **PostgreSQL** | Wallet Service | `wallets`, `wallet_transactions` | Wallet state, balance, row-level locks, velocity caps |
| **PostgreSQL** | Payment Service | `payments`, `payment_attempts`, `outbox_events` | Payment lifecycle, provider attempts history, outbox events |
| **PostgreSQL** | Ledger Service | `ledger_accounts`, `ledger_entries` | Double-entry accounting records (`SUM(DEBIT) == SUM(CREDIT)`) |
| **PostgreSQL** | Refund Service | `refunds` | Refund lifecycle records |
| **PostgreSQL** | Shared Gateway | `idempotency_records` | Durable persistence of idempotency request responses |
| **MongoDB** | Event / Audit Store | `webhook_events`, `payment_events`, `audit_logs`, `notification_logs`, `dlq_records` | Raw provider payload audit trails & dead-letter queue records |
| **Redis** | Infrastructure / Coordination | Rate limits, Idempotency claims (`SET NX`), Read-through cache, Distributed locks (`payment:lock:{id}`), BullMQ | Fast coordination, concurrency control, distributed locking |

---

## 🧩 Microservices & Responsibilities

```text
AtomPay_Microservice/
├── api-gateway/            # Security, Rate Limiting, JWT Verification, Idempotency, Request Routing
├── services/
│   ├── auth-service/       # Signup, Login, Tokens, OTP, Password & PIN Management
│   ├── wallet-service/     # Wallet Balance, Row-Locked Transfers, Transactions, QR Code, Velocity Limits
│   ├── payment-service/    # Payment Lifecycle, State Machine, Attempts History, Transactional Outbox
│   ├── webhook-service/    # Webhook HMAC Signature Verification, Deduplication, Financial Settlement
│   ├── ledger-service/     # Double-Entry Accounting, Invariant Auditing
│   ├── refund-service/     # Refund Processing & State Management
│   └── notification-service/# Asynchronous Email/SMS Notification Dispatcher
├── workers/
│   ├── payment-worker/     # BullMQ Worker, Redis Lock, Circuit Breaker Provider Calls, DLQ
│   ├── outbox-publisher.js # Polling Daemon Publishing Outbox Events to BullMQ
│   └── reconciliation-worker/# Periodically Resolves UNKNOWN & Stuck Payments
├── packages/
│   ├── shared-events/      # Domain Event Constants & BullMQ Queue Definitions
│   ├── database/           # PostgreSQL Pool, Redis Client, Mongoose Helpers
│   ├── logger/             # Structured JSON Logger with Sensitive Data Masking
│   └── circuit-breaker/    # Opossum Circuit Breaker Abstraction
├── infrastructure/postgres/# PostgreSQL DDL Schema (`init.sql`)
└── tests/                  # 21 Automated Failure Scenario Tests (`scenarios.test.js`)
```

---

## ⚡ Key Architectural Patterns

### 1. Transactional Outbox Pattern
To prevent distributed transaction failures or process crashes between database writes and message queue publication, state updates and event logs are committed atomically within the same PostgreSQL transaction:

```sql
BEGIN;
UPDATE payments SET status = 'SUCCESS' WHERE payment_id = 'pay_123';
INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, payload, status)
VALUES ('evt_1', 'payment.succeeded', 'payment', 'pay_123', '{...}', 'PENDING');
COMMIT;
```

An asynchronous **Outbox Publisher** daemon polls `outbox_events` (`status = 'PENDING'`), publishes them to BullMQ queues, and marks them as `PUBLISHED`.

### 2. Distributed Locking & Concurrent Transfer Protection
- **Wallet Transfers**: Employs PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) sorted deterministically by `user_id` to prevent deadlocks, double-spending, and race conditions.
- **Payment Processing**: Uses Redis distributed locks (`payment:lock:{paymentId}`) with 30-second TTLs to ensure only one worker processes an attempt at a time.

### 3. Double-Entry Accounting Ledger
The Ledger Service enforces the fundamental accounting invariant across all transactions:

$$\sum \text{DEBIT} = \sum \text{CREDIT}$$

Ledger entries are strictly immutable. Corrections are performed exclusively through compensating entries.

### 4. Opossum Circuit Breaker & UNKNOWN Payment State
External provider calls are wrapped in Opossum circuit breakers (`CLOSED` -> `OPEN` -> `HALF_OPEN`).
- If an external call times out or experiences a network failure, the payment state is marked as **`UNKNOWN`** — **NEVER `FAILED`**.
- The **Reconciliation Worker** periodically polls the Provider Status API to safely resolve `UNKNOWN` payments to `SUCCESS` or `FAILED`.

### 5. Idempotency Handling (Redis + PostgreSQL)
For payment and transfer requests containing an `Idempotency-Key` header:
1. Fast atomic claim via Redis `SET NX` with 60s lock TTL.
2. If already processed, the response is instantly replayed from Redis cache or PostgreSQL `idempotency_records`.
3. If new, the transaction executes and the final response is saved durably in PostgreSQL.

---

## 🧪 21 Automated Failure Scenario Tests

Run the test suite to verify system resilience:

```bash
$env:NODE_PATH="backend/node_modules"; node tests/scenarios.test.js
```

### Verified Scenarios:
1. Same payment request sent twice returns cached response.
2. Same idempotency key sent concurrently handles lock contention cleanly.
3. Two workers processing the same payment are synchronized by Redis distributed locks.
4. Worker crash leaves lock to expire safely.
5. Provider timeout sets status to `UNKNOWN`, NOT `FAILED`.
6. Lost HTTP responses are recovered by status lookup / webhooks.
7. Provider duplicate webhooks are deduplicated via event IDs.
8. Invalid HMAC webhook signatures are rejected (401).
9. Missing webhooks are caught and resolved by the Reconciliation worker.
10. Rate limiter fails open gracefully if Redis is temporarily offline.
11. PostgreSQL transaction rolls back balance changes on insufficient funds.
12. Outbox publisher safely retries pending events upon recovery.
13. Queue backoff strategy retries failed job enqueueing.
14. Payment provider errors trip the circuit breaker.
15. Circuit breaker `OPEN` state rejects external calls fast without hanging.
16. Payment status remains `UNKNOWN` if provider is still unreachable.
17. Reconciliation resolves `UNKNOWN` -> `SUCCESS` after provider query.
18. Jobs exceeding maximum retries enter the Dead Letter Queue (DLQ).
19. Double-entry ledger invariant verifies `SUM(DEBIT) == SUM(CREDIT)`.
20. Notification service failure does not roll back successful financial transactions.
21. Logger automatically redacts passwords, PINs, and secret keys.

---

## 🚀 Local Development & Docker Instructions

### 1. Environment Setup
Copy variables to `.env` or set defaults:

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/atompay
MONGO_URL=mongodb://localhost:27017/atompay?replicaSet=rs0
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-key-atompay
PAYMENT_WEBHOOK_SECRET=dev-payment-webhook-secret
MAINTENANCE_MODE=false
```

### 2. Run with Docker Compose
Start the complete containerized stack (Gateway, 7 Microservices, 3 Workers, PostgreSQL, MongoDB, Redis, AtomAI, Frontend):

```bash
docker compose up --build -d
```

Check running services:
```bash
docker compose ps
```

---

## 📡 API Endpoints Map

### API Gateway (`http://localhost:3000`)

#### Auth Service (`/api/auth`)
- `POST /api/auth/signup` — User registration with OTP verification & PIN setup
- `POST /api/auth/login` — User authentication returning JWT tokens
- `POST /api/auth/send-signup-otp` — Send OTP for registration
- `POST /api/auth/send-otp` — Send OTP after password check
- `POST /api/auth/forgot-password` — Password reset request
- `POST /api/auth/reset-password` — Password reset with OTP
- `POST /api/auth/verify-otp` — Verify OTP
- `POST /api/auth/refresh` — Refresh access token
- `POST /api/auth/logout` — Revoke session
- `PATCH /api/auth/change-password` — Change password (Auth)
- `PATCH /api/auth/change-pin` — Change 6-digit wallet PIN (Auth)

#### Wallet Service (`/api/wallet` & `/api/transaction`)
- `GET /api/wallet/balance` — Fetch wallet balance & QR code (Redis cached)
- `GET /api/wallet/transactions` — Fetch recent wallet transactions (Redis cached)
- `POST /api/transaction/transfer` — Execute wallet-to-wallet transfer (Row locked, Idempotent)

#### Payment Service (`/api/payments`)
- `POST /api/payments/topup` — Initiate wallet top-up payment
- `GET /api/payments/:paymentId` — Fetch payment status & history

#### Refund Service (`/api/refunds`)
- `POST /api/refunds` — Request refund for successful payment

#### Webhook Service (`/api/webhooks` & `/webhook`)
- `POST /api/webhooks/payment` — Receive payment gateway webhooks (HMAC SHA256 verified)

#### Ledger Service (`/api/ledger`)
- `GET /api/ledger/accounts` — Fetch accounting ledger accounts
- `GET /api/ledger/entries` — Fetch double-entry accounting log
- `GET /api/ledger/verify-invariants` — Verify `SUM(DEBIT) == SUM(CREDIT)` balance

---

## 🛡 License

ISC License. Built for AtomPay.
