# Sabo Finance — Product Architecture

> This document describes the full technical architecture of Sabo Finance for use in PRDs, engineering planning, and technical diagrams.
> Last updated: 2026-04-03

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Core Capabilities](#core-capabilities)
3. [Tech Stack](#tech-stack)
4. [System Architecture Diagram](#system-architecture-diagram)
5. [Module Breakdown](#module-breakdown)
6. [Data Model](#data-model)
7. [Key Flows](#key-flows)
8. [Background Jobs](#background-jobs)
9. [Security Architecture](#security-architecture)
10. [Third-Party Integrations](#third-party-integrations)
11. [Environment Configuration](#environment-configuration)
12. [Deployment](#deployment)

---

## Product Overview

**Sabo Finance** is a multi-currency peer-to-peer (P2P) foreign exchange platform. It enables users in Nigeria to buy and sell foreign currencies (GBP, USD, CAD) at rates negotiated directly with other users, bypassing traditional FX intermediaries. The platform provides escrow-backed trade settlement, admin-supervised deposits, and a full ledger for every money movement.

**Key differentiators:**
- P2P marketplace with user-set rates and escrow protection
- Multi-currency wallets (NGN, GBP, USD, CAD)
- Counter-offer (bid) system for rate negotiation
- KYC-gated trading with admin review
- Complete transaction audit trail (ledger)
- Two-factor login (password + email OTP) for both users and admins

---

## Core Capabilities

| Capability | Description |
|------------|-------------|
| **Authentication** | JWT-based auth with OTP second factor; sliding window refresh |
| **Multi-Currency Wallets** | Four wallets per user; balances, locked, and escrow buckets |
| **Deposits** | NGN via Flutterwave; Foreign via manual upload + admin approval |
| **Withdrawals** | User-initiated to saved beneficiaries; admin-approved |
| **KYC Verification** | Document + selfie upload; admin approve/reject workflow |
| **P2P Trading (Sabits)** | Create BUY/SELL listings; funds locked on listing creation |
| **Trade Execution** | PIN-verified initiation + seller confirmation; atomic settlement |
| **Bids** | Counter-offer system on SELL listings; 24-hour expiry |
| **Escrow** | Funds locked during trade; released on completion or cancellation |
| **Conversions** | Internal cross-currency wallet swaps at platform FX rates |
| **Disputes** | Raise dispute on active trades; admin resolution |
| **Ratings** | Post-trade seller ratings (1–5 stars) |
| **Notifications** | In-app (per-user and broadcast); email notifications |
| **Admin Dashboard** | Stats, KYC queue, deposit queue, audit logs, analytics |
| **Admin Governance** | Super admin invite system; role management; action audit trail |
| **Reference Generation** | Atomic, collision-safe references per scope (DEP, TXN, WDR, BID) |

---

## Tech Stack

### Runtime & Framework

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20+ |
| Language | TypeScript | 5.x |
| Framework | Express.js | 4.21 |
| ORM | TypeORM | 0.3.26 |
| Database | PostgreSQL | 15+ |
| Validation | Zod | 3.x |
| Auth | jsonwebtoken | 9.x |
| Password Hashing | bcrypt | 6.x |
| Decimal Arithmetic | Decimal.js | 10.x |
| File Upload | multer | 1.x |
| API Docs | Swagger UI (swagger-jsdoc) | — |
| Testing | Jest + Supertest | — |
| Background Jobs | BullMQ | 5.x |
| Job Queue Backend | Redis | — |

### Infrastructure & External Services

| Service | Purpose |
|---------|---------|
| **Flutterwave** | NGN deposit processing & webhook-based confirmation |
| **Cloudinary** | KYC document & profile picture storage |
| **SMTP / Resend** | Transactional email delivery |
| **Render** | Cloud deployment platform |
| **Redis** | BullMQ job queue for background workers |

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                │
│   Web App (React)  ·  Mobile App  ·  Admin Dashboard               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXPRESS API SERVER                             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   authMW     │  │  adminMW     │  │  kycMW / rateLimiter     │  │
│  │  (JWT verify)│  │ (role check) │  │  (KYC gate / OTP limit)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                       ROUTE MODULES                          │   │
│  │  /auth  /account  /wallets  /ledger  /deposits  /withdrawals │   │
│  │  /beneficiaries  /kyc  /rates  /conversions  /sabits         │   │
│  │  /trades  /bids  /disputes  /ratings  /notifications         │   │
│  │  /admin  /webhooks                                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │                   SERVICE LAYER                           │      │
│  │  WalletService · NotificationService · EmailService       │      │
│  │  ReferenceService · PinService · UsernameService          │      │
│  └───────────────────────────────────────────────────────────┘      │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐      │
│  │             withTransaction (QueryRunner)                 │      │
│  │         All writes use atomic DB transactions             │      │
│  └───────────────────────────────────────────────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────────┐
              ▼                ▼                    ▼
    ┌──────────────┐  ┌──────────────┐   ┌──────────────────┐
    │  PostgreSQL  │  │    Redis     │   │  External APIs   │
    │              │  │  (BullMQ)    │   │  Flutterwave     │
    │  All tables  │  │  Job queues  │   │  Cloudinary      │
    │  Ledger      │  │              │   │  SMTP/Resend     │
    └──────────────┘  └──────┬───────┘   └──────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Background Jobs │
                    │  PIN Expiry     │
                    │  Bid Expiry     │
                    │  Deposit Expiry │
                    │  FX Rate Sync   │
                    └─────────────────┘
```

---

## Module Breakdown

The codebase follows a **modular monolith** pattern. Each domain lives in `src/modules/<name>/`.

```
src/
├── modules/
│   ├── auth/               # Register, login (OTP), token refresh, email verify
│   ├── account/            # PIN, username, profile picture, email change, account delete
│   ├── wallets/            # View wallets by currency
│   ├── ledger/             # Transaction history (all movements)
│   ├── deposits/           # NGN (Flutterwave) + Foreign (manual) deposits
│   ├── withdrawals/        # Withdrawal requests to beneficiaries
│   ├── beneficiaries/      # Saved bank accounts for withdrawals
│   ├── kyc/                # Document upload and status check
│   ├── exchange-rates/     # FX rate lookup
│   ├── conversions/        # Quote + execute internal currency swaps
│   ├── sabits/             # P2P listings (BUY/SELL)
│   ├── trades/             # Trade initiation, confirmation, completion
│   ├── bids/               # Counter-offers on sabits
│   ├── disputes/           # Dispute raising and listing
│   ├── ratings/            # Post-trade seller ratings
│   ├── notifications/      # In-app notification management
│   ├── admin/              # All admin operations
│   └── transactions/       # (Index placeholder)
│
├── database/
│   ├── entities/           # TypeORM entity definitions (16 tables)
│   ├── migrations/         # 19 versioned schema migrations
│   ├── transaction.ts      # withTransaction helper (QueryRunner wrapper)
│   └── data-source.ts      # TypeORM DataSource config
│
├── services/
│   ├── walletService.ts    # credit, debit, lock, unlock, transfer, transferFromLocked
│   ├── emailService.ts     # Send templated emails (SMTP or Resend)
│   ├── notificationService.ts  # Create in-app notifications
│   ├── referenceService.ts # Atomic sequence reference generation
│   ├── pinService.ts       # Transaction PIN hashing and verification
│   └── usernameService.ts  # Collision-safe username generation
│
├── middleware/
│   ├── authMiddleware.ts   # JWT verification, user load, sliding refresh
│   ├── adminMiddleware.ts  # Role-based access (admin, super_admin)
│   ├── kycMiddleware.ts    # KYC-verified gate
│   ├── errorHandler.ts     # Global error handler + Zod/PG error mapping
│   └── rateLimiter.ts      # OTP and invite rate limits
│
├── providers/
│   └── payments/
│       └── flutterwave.ts  # Flutterwave deposit initiation + webhook processing
│
├── jobs/
│   ├── pinExpiryJob.ts     # Cancel trades with expired PINs
│   ├── bidExpiryJob.ts     # Expire pending bids after 24h
│   ├── depositExpiryJob.ts # Expire stale initiated deposits
│   ├── fx-rate-sync.queue.ts  # BullMQ queue for FX rate updates
│   └── fx-rate-sync.worker.ts # BullMQ worker consuming FX sync jobs
│
├── utils/
│   ├── enums.ts            # All TypeScript enums (Currency, TradeStatus, etc.)
│   ├── errors.ts           # AppError, NotFoundError, UnauthorizedError, ForbiddenError
│   ├── apiResponse.ts      # ok(), created(), fail() response helpers
│   └── asyncHandler.ts     # Wraps async controllers to catch promise rejections
│
├── config/
│   ├── env.ts              # Typed environment variable access
│   └── cloudinary.ts       # Cloudinary SDK init
│
├── docs/
│   └── swagger.ts          # Swagger/OpenAPI spec generation
│
├── types/
│   └── declarations.d.ts   # Express.Request augmentation (req.user type)
│
├── templates/emails/       # Handlebars/HTML email templates
├── app.ts                  # Express app factory (CORS, middleware, routes, Swagger)
├── server.ts               # Bootstrap: DB connect + start jobs + listen
└── routes.ts               # Root API router (mounts all module routers)
```

---

## Data Model

### Entity Relationships

```
users ──────┬──── wallets (1:4, one per currency)
            ├──── ledger (1:N, every fund movement)
            ├──── deposits (1:N)
            ├──── withdrawals (1:N)
            ├──── beneficiaries (1:N)
            ├──── kyc (1:N, latest = current status)
            ├──── sabits (1:N, P2P listings)
            ├──── trades (1:N as buyer OR seller)
            ├──── bids (1:N as buyer OR seller)
            ├──── disputes (1:N as raised_by)
            ├──── trade_ratings (1:N as rater OR rated)
            ├──── notifications (1:N, plus global notifications)
            └──── admin_logs (admin actions only)

sabits ─────┬──── trades (1:N)
            └──── bids (1:N)

trades ─────┬──── disputes (1:1 or 1:N)
            └──── trade_ratings (1:1 per trade per rater)

admin_invites ─── users (inviter → invited)
reference_sequences ─── (standalone, per-scope atomic counter)
exchange_rates ─── (standalone, updated by FX sync job)
```

### Table Summary

| Table | Description | Key Fields |
|-------|-------------|-----------|
| `users` | User accounts | `id`, `email`, `password_hash`, `role`, `kyc_status`, `is_suspended`, `deleted_at`, `transaction_pin_hash`, `otp`, `otp_expires` |
| `wallets` | Per-user per-currency balances | `user_id`, `currency`, `balance`, `locked_balance`, `escrow_balance` |
| `ledger` | Immutable transaction audit trail | `reference`, `type`, `amount`, `balance_before`, `balance_after`, `status` |
| `deposits` | Deposit records | `reference`, `provider`, `status`, `proof_url`, `rejection_reason` |
| `withdrawals` | Withdrawal requests | `reference`, `beneficiary_id`, `status` |
| `beneficiaries` | Saved bank accounts | `currency`, `bank_name`, `account_number`, `iban`, `sort_code` |
| `kyc` | KYC submissions | `document_type`, `document_url`, `selfie_url`, `status`, `rejection_reason` |
| `exchange_rates` | FX rate cache | `pair` (e.g. `GBP/NGN`), `rate`, `source` |
| `sabits` | P2P listings | `type` (BUY/SELL), `currency`, `amount`, `available_amount`, `rate_ngn`, `status` |
| `trades` | Trade execution records | `buyer_id`, `seller_id`, `sabit_id`, `status`, `reference`, `pin_expires_at` |
| `bids` | Counter-offers | `sabit_id`, `proposed_rate_ngn`, `status`, `expires_at` |
| `disputes` | Trade disputes | `trade_id`, `raised_by_id`, `reason`, `status` |
| `trade_ratings` | Post-trade ratings | `trade_id`, `rater_id`, `rated_user_id`, `score` (1–5) |
| `notifications` | In-app alerts | `user_id` (NULL = global), `type`, `status` (unread/read) |
| `admin_logs` | Admin action audit | `admin_id`, `action`, `target_type`, `target_id`, `details` (JSONB) |
| `admin_invites` | Admin onboarding tokens | `token_hash`, `invited_email`, `granted_role`, `expires_at`, `consumed_at` |
| `reference_sequences` | Atomic counters for references | `scope`, `year`, `last_sequence` |

### Financial Precision

- All monetary values stored as `NUMERIC(18,2)` in PostgreSQL
- Passed as `string` in API JSON to prevent floating-point errors
- All arithmetic done with **Decimal.js** in application code

---

## Key Flows

### 1. User Registration
```
Client → POST /auth/register
  → Zod validation
  → bcrypt hash password (12 rounds)
  → withTransaction:
      → INSERT user
      → Generate username (collision-safe)
      → INSERT 4 wallets (NGN, GBP, USD, CAD)
      → CREATE welcome notification
  → Send verification email (JWT token, 1h expiry)
  → Send welcome email
  → Return user + access/refresh tokens
```

### 2. User Login (2FA)
```
Client → POST /auth/login
  → Validate credentials
  → Generate 6-digit OTP (10min expiry)
  → Store OTP hash in users table
  → Send OTP email

Client → POST /auth/verify-otp
  → Validate OTP against DB (expiry check)
  → Clear OTP from DB
  → Return access token (30m) + refresh token (30d)
```

### 3. P2P Trade — Full Flow
```
Seller → POST /sabits       (create listing, lock foreign currency)
Buyer  → POST /trades/initiate  (with PIN, lock buyer's NGN)
           → Notify seller via email + in-app notification
           → 30-minute confirmation window starts

Seller → PUT /trades/:id/seller-confirm  (with PIN, within 30min)
           → Verify PIN
           → SETTLE atomically:
               → Transfer locked NGN from buyer → seller
               → Transfer locked foreign currency from seller → buyer
           → Mark trade as completed
           → Notify both parties via email + in-app

[If PIN expires before seller confirms]
Background job / next seller action
  → Auto-cancel trade
  → Restore sabit available_amount
  → Unlock buyer's NGN
  → Email both parties
```

### 4. Foreign Deposit Flow
```
User → POST /deposits/foreign  (upload proof via Cloudinary)
  → Deposit created as "pending_review"
  → Admin notified

Admin → POST /admin/deposits/:id/approve
  → withTransaction:
      → Credit user wallet
      → Insert ledger entry
      → Mark deposit as "completed"
  → Email user

Admin → POST /admin/deposits/:id/reject
  → Mark deposit as "rejected" with reason
  → Email user
```

### 5. Bid (Counter-Offer) Flow
```
Buyer → POST /bids
  → Lock buyer's NGN at proposed rate
  → Notify seller
  → Bid expires in 24h

Seller → PUT /bids/:id/accept  (with PIN)
  → Create Trade from bid terms
  → Mark bid as accepted
  → Notify buyer

Seller → PUT /bids/:id/reject  (optional reason)
  → Unlock buyer's NGN
  → Notify buyer

Buyer → PUT /bids/:id/withdraw
  → Unlock buyer's NGN
  → Mark bid as withdrawn

Background Job → bidExpiryJob
  → Find bids past expires_at with status = "pending"
  → Unlock funds, mark as "expired"
```

### 6. KYC Flow
```
User → POST /kyc/upload  (document + selfie via Cloudinary)
  → KYC record created as "pending"
  → User kyc_status → "pending"

Admin → POST /admin/kyc/:id/approve
  → KYC status → "verified"
  → User kyc_status → "verified"
  → Email user

Admin → POST /admin/kyc/:id/reject  (with reason)
  → KYC status → "rejected"
  → User kyc_status → "rejected"
  → Email user with reason
```

### 7. Admin Invite Flow
```
Super Admin → POST /admin/invites  (email, role)
  → Generate SHA-256 hashed invite token
  → Store in admin_invites table (72h expiry)
  → Send invite email with link

Invitee → GET /admin/invites/accept?token=...
  → Validate token
  → Return invite metadata

Invitee → POST /admin/invites/setup  (token, name, password)
  → Create admin user account
  → Mark invite as consumed
  → Return tokens
```

---

## Background Jobs

All jobs are implemented as scheduled Node.js intervals (started in `src/server.ts`) with BullMQ used for the FX rate sync queue.

| Job | Frequency | Purpose |
|-----|-----------|---------|
| `pinExpiryJob` | Every 5 minutes | Cancels trades where `pin_expires_at` has passed and `seller_pin_verified = false`. Unlocks buyer funds, restores sabit amount, emails both parties. |
| `bidExpiryJob` | Every 10 minutes | Marks bids as `expired` where `expires_at` has passed and status is still `pending`. Unlocks buyer funds. |
| `depositExpiryJob` | Every 15 minutes | Marks NGN deposits as `expired` if initiated but no webhook received after a timeout window. |
| `FX Rate Sync` | BullMQ queue (periodic) | Fetches latest FX rates from an external source and upserts into `exchange_rates` table. Powers the `GET /rates` endpoint. |

---

## Security Architecture

| Mechanism | Implementation |
|-----------|---------------|
| **Authentication** | JWT (access: 30m user / 8h admin, refresh: 30d). Signed with `JWT_SECRET` / `JWT_REFRESH_SECRET`. |
| **Two-Factor Login** | Email OTP (6-digit, 10min expiry) required after password validation for all logins. |
| **Transaction PIN** | 6-digit PIN hashed with bcrypt. Required to initiate and confirm trades. Auto-expires open PIN windows after 30 minutes. |
| **Password Hashing** | bcrypt with 12 salt rounds. |
| **Password Reset** | SHA-256 hashed token, 10-minute expiry, sent via email link. |
| **Admin Invite Tokens** | SHA-256 hashed, 72-hour expiry, single-use (`consumed_at`). |
| **Rate Limiting** | OTP endpoints: 10 req/15min. Admin invite: 20 req/hour. |
| **Soft Deletes** | Accounts use `deleted_at` rather than hard delete. All auth checks validate `deleted_at IS NULL`. |
| **Account Suspension** | `is_suspended` flag blocks login and all token use. |
| **Webhook Validation** | Flutterwave webhook verified via `verif-hash` header matching `FLUTTERWAVE_WEBHOOK_HASH`. |
| **CORS** | Restricted to origins listed in `CORS_ORIGIN` env var. |
| **Ledger Immutability** | The `ledger` table records every balance change with before/after snapshots. Never updated, only appended. |
| **Database Transactions** | All writes use `withTransaction` (PostgreSQL transactions). Financial operations use `FOR UPDATE` row locks to prevent race conditions. |
| **Role-Based Access** | `user` → `admin` → `super_admin` hierarchy enforced per-route via middleware. |
| **KYC Gate** | P2P trading, conversions, withdrawals, and deposits are blocked unless `kyc_status = "verified"`. |
| **No `any` Types** | TypeScript strict mode enforced project-wide. |

---

## Third-Party Integrations

### Flutterwave
- **Purpose:** NGN deposit processing
- **Integration:** REST API for payment link / charge initiation; webhook for `charge.completed` events
- **Security:** `verif-hash` header validation on all incoming webhooks
- **Reference:** Deposit `reference` field used as `tx_ref` in Flutterwave; matched on webhook receipt

### Cloudinary
- **Purpose:** KYC document, selfie, and profile picture storage
- **Integration:** Cloudinary SDK; files uploaded from memory buffer (multer)
- **Files:** KYC documents, user/admin profile pictures

### Email (SMTP / Resend)
- **Purpose:** Transactional emails (OTP, welcome, KYC status, trade notifications, security alerts)
- **Integration:** Nodemailer via SMTP, with optional Resend API
- **Templates:** Handlebars/HTML templates in `src/templates/emails/`
- **Test bypass:** `EMAIL_ENABLED=false` or `NODE_ENV=test` suppresses all sends

### Redis (BullMQ)
- **Purpose:** Background job queue for FX rate synchronization
- **Integration:** BullMQ producer/worker pattern; `REDIS_URL` env var

---

## Environment Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `development` \| `test` \| `production` |
| `PORT` | No | HTTP port (default: `3000`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes | Secret for signing refresh tokens |
| `SMTP_HOST` | Email | SMTP server hostname |
| `SMTP_PORT` | Email | SMTP port (e.g., `587`) |
| `SMTP_USER` | Email | SMTP username |
| `SMTP_PASS` | Email | SMTP password |
| `EMAIL_ENABLED` | No | `true` \| `false` (disable email in dev) |
| `FLUTTERWAVE_SECRET` | Payments | Flutterwave secret key |
| `FLUTTERWAVE_PUBLIC_KEY` | Payments | Flutterwave public key |
| `FLUTTERWAVE_WEBHOOK_HASH` | Payments | Webhook verification hash |
| `CLOUDINARY_URL` | Files | Cloudinary connection URL |
| `REDIS_URL` | Jobs | Redis connection string for BullMQ |
| `CORS_ORIGIN` | Yes | Comma-separated allowed origins |
| `API_BASE_URL` | No | API base for building links in emails |
| `WEBSITE_URL` | No | Frontend URL for email links |
| `HELP_CENTER_URL` | No | Help center URL for email footer |
| `CONTACT_URL` | No | Contact page URL for email footer |

---

## Deployment

- **Platform:** Render (cloud PaaS)
- **Build:** TypeScript compiled via `tsc`; test files excluded via `tsconfig.json`
- **Migrations:** Run explicitly via `npm run migration:run` before each deployment
- **Environment:** Variables injected by Render (no `.env` files in production)
- **Start command:** `node dist/server.js`
- **Test DB:** Separate `sabo_finance_test` database; migrations applied via `npm run migration:run:test`

### npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with ts-node + watch |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run Jest test suite |
| `npm run migration:generate` | Generate new migration from entity changes |
| `npm run migration:run` | Apply pending migrations (production DB) |
| `npm run migration:run:test` | Apply pending migrations (test DB) |
| `npm run migration:revert` | Revert last migration |

---

## Diagram Reference (for Technical Diagrams)

The following components and their relationships are the key nodes to represent in any architectural diagram:

**Frontend clients** → `Express API` → `Middleware chain` (Auth JWT → Role check → KYC gate) → `Route handler` → `withTransaction` → `PostgreSQL`

**Async paths:**
- `Express API` → `Cloudinary` (file uploads)
- `Flutterwave` → `POST /webhooks/flutterwave` → `PostgreSQL` (wallet credit)
- `Cron/BullMQ jobs` → `PostgreSQL` (state transitions)
- `Express API` → `SMTP/Resend` → `User email`

**Actor roles:**
- `User` (unverified → KYC pending → KYC verified → trading)
- `Admin` (KYC queue, deposit queue, user management)
- `Super Admin` (admin governance, invites, role management)
- `System` (background jobs, webhook processor)

**Core data stores:**
- `PostgreSQL` — primary data store (all entities)
- `Redis` — BullMQ job queue (FX rate sync)
- `Cloudinary` — file storage (KYC docs, profile pictures)
