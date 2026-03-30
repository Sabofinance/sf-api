## Sabo Finance Backend (Phase 1)

Sabo Finance is a multi-currency P2P exchange backend (NGN, GBP, USD, CAD). Phase 1 implements the core rails needed to:

1. Onboard users (signup, login OTP, email verification, account security)
2. Enforce compliance (KYC)
3. Fund accounts (NGN deposits via Flutterwave webhooks; manual foreign deposits)
4. Trade in a safe, auditable way (wallet locking, escrow, immutable ledger)
5. Resolve edge cases (expired bids/trades, disputes, ratings, notifications)
6. Administer the platform (admin login + invitations, KYC approvals, deposit approvals, governance logs)

## Table of Contents

- [High-Level System Architecture](#high-level-system-architecture)
- [Core Concepts](#core-concepts)
- [Security Model](#security-model)
- [Background Jobs](#background-jobs)
- [Email System](#email-system)
- [User Journey (End to End)](#user-journey-end-to-end)
  - [1) Sign Up + Email Verification](#1-sign-up--email-verification)
  - [2) Login (OTP) + Refresh Tokens](#2-login-otp--refresh-tokens)
  - [3) Account Security Setup (Transaction PIN)](#3-account-security-setup-transaction-pin)
  - [4) KYC](#4-kyc)
  - [5) Wallets + Balances](#5-wallets--balances)
  - [6) Deposits](#6-deposits)
  - [7) Create Listings (SABITs)](#7-create-listings-sabits)
  - [8) Place Bids](#8-place-bids)
  - [9) Trades (Initiate, Confirm, Complete)](#9-trades-initiate-confirm-complete)
  - [10) Disputes + Ratings](#10-disputes--ratings)
  - [11) Withdrawals + Beneficiaries](#11-withdrawals--beneficiaries)
  - [12) Conversions](#12-conversions)
  - [13) Notifications](#13-notifications)
  - [14) Account Deletion + Email Change](#14-account-deletion--email-change)
- [Admin Journey](#admin-journey)
- [API Endpoints (Complete Catalog)](#api-endpoints-complete-catalog)
  - [Health Check](#health-check)
  - [Auth](#auth)
  - [Account](#account)
  - [KYC](#kyc)
  - [Wallets](#wallets)
  - [Deposits + Webhooks](#deposits--webhooks)
  - [Beneficiaries](#beneficiaries)
  - [Withdrawals](#withdrawals)
  - [Sabits (Listings)](#sabits-listings)
  - [Bids (Offers)](#bids-offers)
  - [Trades (Escrow Flow)](#trades-escrow-flow)
  - [Disputes](#disputes)
  - [Ratings](#ratings)
  - [Ledger](#ledger)
  - [Conversions](#conversions)
  - [Notifications](#notifications)
  - [Exchange Rates](#exchange-rates)
  - [Admin / Governance](#admin--governance)
- [Error Handling & Response Format](#error-handling--response-format)
- [Environment Variables](#environment-variables)

## High-Level System Architecture

```mermaid
flowchart LR
  Client[Client App] -->|HTTPS| Express[Express API]
  Express --> Middleware[Middlewares\nAuth, Admin, KYC Guard, Rate Limiter]
  Middleware --> Controllers[Domain Controllers\nAuth, Account, KYC, Deposits, Trading, Admin...]
  Controllers --> Services[Shared Services\nWalletService, PinService,\nReferenceService, EmailService,\nNotificationService]
  Services --> Tx[TypeORM withTransaction\n(QueryRunner transaction)]
  Tx --> DB[(PostgreSQL)]
  Services --> Jobs[Background Jobs (BullMQ)]
  Jobs --> Redis[(Redis)]
```

### Key implementation guarantees
- Every money movement is executed inside a DB transaction and written to the immutable `ledger` table via `WalletService`.
- OTPs are purpose-scoped to prevent collisions between login OTP, deletion OTP, and email-change OTP.
- Sellers must set a transaction PIN before creating SELL listings (SABITs).

## Core Concepts

### Wallets
- Each user has one wallet per currency.
- Wallet fields:
  - `balance`: available funds
  - `locked_balance`: funds reserved for escrow/holds (trades/bids)

### Immutable Ledger
- Every movement creates an append-only `ledger` row (no updates).
- Ledger entries track:
  - `type` (deposit, withdrawal, trade_debit, trade_credit, escrow_hold, escrow_release, reversal, adjustment, etc.)
  - `balance_before` and `balance_after`
  - `reference` (human-auditable)

### SABITs, Bids, Trades
- `sabits`: marketplace listings created by sellers (type SELL/BUY).
- `bids`: buyer offers against a sabit.
- `trades`: the escrow flow that occurs after bids are accepted and confirmations happen.

### KYC
- KYC is required for:
  - Deposits
  - Trading flows (sabits creation and bid/trade flows)
  - Withdrawals
- KYC status is visible via `GET /kyc/status`.

### Notifications & Emails
- The backend records notifications and sends emails for key lifecycle events:
  - welcome + email verification
  - OTPs
  - deposits confirmed
  - trade initiated/completed
  - pin expiry cancellation
  - admin actions

## Security Model

### Auth & session lifecycle
- Login uses OTP:
  - `POST /auth/login` sends an OTP to email.
  - `POST /auth/verify-otp` verifies OTP and returns JWT access + refresh tokens.
- Sliding token window:
  - Auth middleware refreshes access token via response headers (`x-access-token`, `x-token-refreshed`) when access token is near expiry.
- Active-user enforcement:
  - Auth middleware queries the user row on every request to instantly block:
    - soft-deleted users (`deleted_at`)
    - suspended users (`is_suspended`)

### Transaction PIN
- Protects sensitive actions (confirm trades).
- Before trading:
  - users must set a 6-digit transaction PIN with `POST /account/transaction-pin/set`.
- Sellers:
  - must have a transaction PIN set before creating a SELL SABIT.

### OTP purpose scoping
- OTPs are stored with:
  - `otp_purpose` (e.g. `login`, `account-delete`, `email-change`, `admin-login`)
  - `otp_target_email` (for email change flows)
- This prevents OTP reuse across unrelated actions.

### Rate limiting
- Sensitive OTP endpoints and admin invite creation are protected with dedicated rate limiting middleware.

### Soft delete
- Account deletion is a two-step flow:
  - password + OTP initiate
  - password + OTP confirm
- Deletion sets `deleted_at` and suspends the account.

## Background Jobs

This Phase 1 includes BullMQ workers to keep the system consistent even when clients do nothing:
- `pin-expiry` job:
  - Cancels unconfirmed trades when the PIN confirmation window expires.
  - Releases funds back to listings.
  - Notifies buyer and seller + emails.
- `bid-expiry` job:
  - Expires pending bids when `expires_at` is reached.
  - Unlocks escrow and notifies buyer + emails.

## Email System

### Templates
- HTML templates live in `src/templates/emails/*.html`.
- Template tokens use `{{variable}}` placeholders.

### Standard footers and support links
- `src/services/emailService.ts` injects:
  - website URL
  - help center
  - contact
  - support email
- This ensures every important email includes the "how to contact us" section.

### Welcome email
- A dedicated warm onboarding template exists:
  - `src/templates/emails/welcome.html`
- It is sent during registration (after the verification email).

## User Journey (End to End)

Below is the expected end-user flow from signup to trading, including optional branches like account deletion and email change.

### 1) Sign Up + Email Verification

1. Create an account
   - `POST /auth/register`
2. Receive two emails:
   - Email verification link
   - Welcome onboarding email
3. Verify email via token
   - `GET /auth/verify-email?token=...`

Notes:
- Verification link uses `API_BASE_URL`.
- Verification sets `email_verified = true`.

### 2) Login (OTP) + Refresh Tokens

1. Start login by submitting email + password
   - `POST /auth/login`
   - Server sends OTP via email.
2. Verify OTP to obtain tokens
   - `POST /auth/verify-otp`
3. Optional: renew access token
   - `POST /auth/refresh-token`

Notes:
- The system rejects deleted/suspended users at login and on refresh.
- Access tokens may be automatically renewed by auth middleware while you stay active.

### 3) Account Security Setup (Transaction PIN)

1. Set transaction PIN
   - `POST /account/transaction-pin/set`
2. Verify transaction PIN (client-side validation)
   - `POST /account/transaction-pin/verify`

Important:
- Some trading flows require PIN immediately (e.g., trade confirmations).

### 4) KYC

1. Check KYC status
   - `GET /kyc/status`
2. Upload KYC documents
   - `POST /kyc/upload`
   - multipart fields:
     - `document` (ID document)
     - `selfie` (selfie image)

KYC is required for deposits and trading.

### 5) Wallets + Balances

1. List wallets for all supported currencies
   - `GET /wallets/`
2. Get a single wallet by currency
   - `GET /wallets/:currency`

Balances are strings using the stored `numeric(18,2)` precision rules.

### 6) Deposits

Phase 1 supports two deposit types:

#### 6a) NGN deposits (Flutterwave)
1. Initiate deposit
   - `POST /deposits/ngn/initiate`
2. Flutterwave sends webhook
   - `POST /webhooks/flutterwave`
3. Webhook:
   - credits wallet via `WalletService`
   - writes an immutable ledger entry
   - updates the deposit to `completed`

List your deposits:
- `GET /deposits/`
- `GET /deposits/:id`

#### 6b) Foreign deposits (manual proof + admin approval)
1. Submit foreign deposit proof
   - `POST /deposits/foreign`
   - multipart:
     - `proof` file
   - fields:
     - `currency` (GBP/USD/CAD)
     - `amount`
2. Admin approvals:
   - `POST /admin/deposits/:id/approve`
   - or reject:
     - `POST /admin/deposits/:id/reject`

### 7) Create Listings (SABITs)

1. Browse public listings:
   - `GET /sabits`
   - `GET /sabits/:id`
2. Create a listing (requires KYC)
   - `POST /sabits`
3. Cancel a listing you own
   - `POST /sabits/:id/cancel`

Security requirement:
- When creating a SELL SABIT, the system enforces `transaction_pin_set = true`.

### 8) Place Bids

Bid endpoints (requires auth; requires verified KYC for placing):
1. Place a bid:
   - `POST /bids`
2. View your bids:
   - `GET /bids/mine`
3. View received bids:
   - `GET /bids/received`
4. Seller actions:
   - accept:
     - `PUT /bids/:id/accept`
   - reject:
     - `PUT /bids/:id/reject`
5. Buyer actions:
   - withdraw:
     - `PUT /bids/:id/withdraw`

Background jobs:
- Expired bids are automatically marked expired and funds are unlocked.

### 9) Trades (Initiate, Confirm, Complete)

Trade endpoints (requires auth; requires KYC):
1. Initiate a trade:
   - `POST /trades/initiate`
2. Buyer confirmation:
   - `POST /trades/:id/confirm`
3. Seller confirmation:
   - `PUT /trades/:id/seller-confirm`
4. Complete trade:
   - `POST /trades/:id/complete`

Timing protection:
- PIN confirmations expire (handled by BullMQ `pin-expiry` job).

### 10) Disputes + Ratings

Disputes (requires KYC and auth):
- Raise dispute:
  - `POST /disputes/raise`
- List disputes:
  - `GET /disputes/`
- Get a dispute:
  - `GET /disputes/:id`

Ratings:
- Public reputation view:
  - `GET /ratings/user/:id`
- Submit a rating (after a completed trade, requires KYC):
  - `POST /ratings`
  - body includes: `trade_id`, `score`, optional `comment`

### 11) Withdrawals + Beneficiaries

Beneficiaries (requires KYC and auth):
- Create beneficiary:
  - `POST /beneficiaries`
- List beneficiaries:
  - `GET /beneficiaries`
- Delete beneficiary:
  - `DELETE /beneficiaries/:id`

Withdrawals (requires KYC and auth):
- Request withdrawal:
  - `POST /withdrawals/request`
- List withdrawals:
  - `GET /withdrawals`
- Get one withdrawal:
  - `GET /withdrawals/:id`

### 12) Conversions

Conversions allow exchanging between currencies within the platform:
- Quote:
  - `POST /conversions/quote`
- Execute:
  - `POST /conversions/execute`

Both require KYC and auth.

### 13) Notifications

Notifications are stored and can be marked read:
- List:
  - `GET /notifications`
- Mark all read:
  - `POST /notifications/mark-all-read`
- Mark one read:
  - `PATCH /notifications/:id/read`

### 14) Account Deletion + Email Change

All flows require authentication.

#### Account deletion (soft delete; password + OTP)
1. Initiate deletion:
   - `POST /account/delete/initiate`
2. Confirm deletion:
   - `POST /account/delete/confirm`

#### Email change (OTP to new email + alert old email)
1. Initiate email change:
   - `POST /account/email-change/initiate`
2. Confirm email change:
   - `POST /account/email-change/confirm`

## Admin Journey

Admin accounts use the same underlying `users` table with `role` set to `admin` or `super_admin`.

1. Super admin invites an admin:
   - `POST /admin/invites` (super-admin only; rate-limited)
2. Invitee accepts invite token:
   - `GET /admin/invites/accept?token=...`
3. Admin logs in:
   - `POST /admin/auth/login` (admin email + password)
   - `POST /admin/auth/verify-otp` (email OTP)

Admin actions:
- manage users:
  - list, suspend, reinstate, remove admin, upgrade admin to super admin
- manage KYC:
  - approve/reject submissions
- manage deposits:
  - approve/reject manual deposits
  - verify NGN deposits via Flutterwave when configured
- view platform logs and dashboard analytics

## API Endpoints (Complete Catalog)

### Health Check
- `GET /health`

### Auth
- `POST /auth/register`
- `GET /auth/verify-email?token=...`
- `POST /auth/login`
- `POST /auth/verify-otp`
- `POST /auth/refresh-token`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`

### Account
(Authenticated via `authMiddleware`)
- `PUT /account/username`
- `POST /account/transaction-pin/set`
- `POST /account/transaction-pin/verify`
- `POST /account/delete/initiate`
- `POST /account/delete/confirm`
- `POST /account/email-change/initiate`
- `POST /account/email-change/confirm`

### KYC
(Authenticated + KYC upload routes require auth)
- `POST /kyc/upload` (multipart: `document`, `selfie`)
- `GET /kyc/status`

### Wallets
(Authenticated)
- `GET /wallets/`
- `GET /wallets/:currency`

### Deposits + Webhooks
(Authenticated, KYC required for deposit actions)
- `POST /deposits/ngn/initiate`
- `POST /deposits/foreign` (multipart: `proof`)
- `GET /deposits/`
- `GET /deposits/:id`
- `POST /webhooks/flutterwave` (webhook endpoint; typically no auth middleware)

### Beneficiaries
(Authenticated + KYC required)
- `POST /beneficiaries`
- `GET /beneficiaries`
- `DELETE /beneficiaries/:id`

### Withdrawals
(Authenticated + KYC required)
- `POST /withdrawals/request`
- `GET /withdrawals`
- `GET /withdrawals/:id`

### Sabits (Listings)
- `GET /sabits` (public)
- `GET /sabits/:id` (public)
- `POST /sabits` (requires auth + KYC)
- `POST /sabits/:id/cancel` (requires auth + KYC)

### Bids (Offers)
- `POST /bids` (requires auth + KYC)
- `GET /bids/mine` (requires auth)
- `GET /bids/received` (requires auth)
- `PUT /bids/:id/accept` (requires auth)
- `PUT /bids/:id/reject` (requires auth)
- `PUT /bids/:id/withdraw` (requires auth)

### Trades (Escrow Flow)
(requires auth + KYC)
- `POST /trades/initiate`
- `POST /trades/:id/confirm`
- `PUT /trades/:id/seller-confirm`
- `POST /trades/:id/complete`

### Disputes
(requires auth + KYC)
- `POST /disputes/raise`
- `GET /disputes/`
- `GET /disputes/:id`

### Ratings
- `GET /ratings/user/:id` (public)
- `POST /ratings` (requires auth + KYC)

### Ledger
(requires auth)
- `GET /ledger/`
- `GET /ledger/:walletId`

### Conversions
(requires auth + KYC)
- `POST /conversions/quote`
- `POST /conversions/execute`

### Notifications
(requires auth)
- `GET /notifications`
- `POST /notifications/mark-all-read`
- `PATCH /notifications/:id/read`

### Exchange Rates
- `GET /rates/`

### Admin / Governance

Admin auth (public)
- `POST /admin/auth/login`
- `POST /admin/auth/verify-otp`
- `GET /admin/invites/accept?token=...`

Admin management (authenticated)
- `POST /admin/invites` (super-admin only)
- `POST /admin/admins/:id/remove`
- `POST /admin/admins/:id/upgrade`
- `GET /admin/users`
- `GET /admin/users/:id`
- `POST /admin/users/:id/suspend`
- `POST /admin/users/:id/reinstate`
- `GET /admin/profile`
- `POST /admin/profile/picture` (multipart `file`)
- `GET /admin/logs`

Admin KYC
- `GET /admin/kyc`
- `POST /admin/kyc/:id/approve`
- `POST /admin/kyc/:id/reject`

Admin deposits
- `POST /admin/deposits/:id/approve`
- `POST /admin/deposits/:id/reject`
- `POST /admin/deposits/:id/verify-flutterwave`

Admin dashboard & analytics
- `GET /admin/dashboard`
- `GET /admin/analytics/impact`
- `GET /admin/deposits`
- `GET /admin/disputes`
- `GET /admin/transactions`

## Error Handling & Response Format

All endpoints respond with a consistent envelope:
- `success`: boolean
- `data`: payload or `null`
- `meta`: object (often empty)
- `error`: `null` or `{ code, message }`

Common error codes include (not exhaustive):
- `VALIDATION_ERROR` (Zod validation)
- `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`
- `NOT_FOUND`
- `DUPLICATE_RESOURCE`, `REFERENCE_CONSTRAINT_ERROR`
- `INVALID_IMAGE_UPLOAD` (Cloudinary/multipart upload issues)
- domain-specific codes like `ACCOUNT_DELETED`, `ACCOUNT_SUSPENDED`, `INVALID_OTP`, `OTP_EXPIRED`, etc.

## Environment Variables

Example:
- `NODE_ENV` (development/test/staging/production)
- `DATABASE_URL`, `DATABASE_URL_TEST`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `CORS_ORIGIN`
- Email:
  - `EMAIL_ENABLED`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `RESEND_API_KEY`
  - `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`
  - `API_BASE_URL` (verification links)
  - `WEBSITE_URL`, `CONTACT_URL`, `HELP_CENTER_URL`, `SUPPORT_EMAIL`
- Flutterwave:
  - `FLUTTERWAVE_SECRET`
  - `FLUTTERWAVE_PUBLIC_KEY` (if used client-side)
  - `FLUTTERWAVE_WEBHOOK_HASH`
- Redis (BullMQ jobs):
  - `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`

## Swagger Docs

Swagger UI is available at:
- `http://localhost:3000/api/docs`


