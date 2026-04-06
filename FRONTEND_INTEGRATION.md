# Sabo Finance — Frontend Integration Guide

> **For the frontend AI assistant:** Read this entire document before writing any code. Key non-obvious decisions to be aware of:
> - `total_active` = KYC-verified AND not suspended — NOT simply "not suspended"
> - `total_registered`, KYC counts, trade totals, escrow, deposits, and P2P stats are **always all-time** — the `from`/`to` window does NOT affect them
> - The `from`/`to` window + `granularity` params **only** control the two growth chart series: `user_growth_monthly` and `trade_volume_monthly`
> - `monthly_active_users` is always a rolling 30-day count, never affected by the `from`/`to` window
> - `escrow.currently_escrowed_trades` is always a live snapshot, never window-scoped
> - Growth chart `label` format depends on `granularity`: `day` → `"Mon"`, `week` → `"Week 1"`, `month` → `"Jan 26"`
> - All financial amounts are **strings** (e.g. `"2830000000.00"`), never JS numbers — use `Number()` only for display
> - `trade_volume_monthly` returns **two volume fields per bucket**: `ngn_volume` (new volume that period) and `cumulative_ngn_volume` (running total from all-time). Use `cumulative_ngn_volume` for the primary growth line so the current (incomplete) month never shows ₦0 — it always carries forward the prior total.
> - `user_growth_monthly` similarly returns `new_users` (registrations that period) and `cumulative_users` (all-time running total including pre-window users). Use `cumulative_users` for the primary growth line.
> - The token refresh endpoint is `POST /auth/refresh-token` (NOT `/auth/refresh`)
> - Bids are **counter-offers on SELL sabits only** and require a PIN. Accepting a bid immediately settles the trade (no separate seller-confirm step).
> - Standard trades (via `POST /trades/initiate`) go into `escrowed` status and require `PUT /trades/:id/seller-confirm` with a PIN within **30 minutes** before the trade auto-cancels.


This document is the single source of truth for integrating the frontend admin portal (and any user-facing clients) with the Sabo Finance backend API.

---

## Table of Contents

1. [Base URL & Environments](#1-base-url--environments)
2. [API Response Envelope](#2-api-response-envelope)
3. [Authentication Flow](#3-authentication-flow)
4. [Token Management](#4-token-management)
5. [Admin Portal — All Endpoints](#5-admin-portal--all-endpoints)
6. [User-Facing Endpoints Reference](#6-user-facing-endpoints-reference)
7. [Metrics Analytics — Full Response Schema](#7-metrics-analytics--full-response-schema)
8. [Dashboard Stats — Response Schema](#8-dashboard-stats--response-schema)
9. [Impact Analytics — Response Schema](#9-impact-analytics--response-schema)
10. [Pagination](#10-pagination)
11. [Error Handling](#11-error-handling)
12. [Chart & UI Recommendations Per Metric](#12-chart--ui-recommendations-per-metric)
13. [TypeScript Types](#13-typescript-types)

---

## 1. Base URL & Environments

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:3000/api` |
| Production  | Set by the backend team on Render |

All endpoints are prefixed with `/api`. Admin routes live under `/api/admin`.

---

## 2. API Response Envelope

Every response — success or error — shares this envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": {},
  "error": null
}
```

On failure:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_ADMIN_CREDENTIALS",
    "message": "Invalid admin email or password."
  }
}
```

**Rule:** Always check `response.success` before reading `response.data`. The `error.code` field is machine-readable and suitable for i18n mapping.

---

## 3. Authentication Flow

### 3.1 Admin Login (Two-Step)

Admin authentication uses a two-step flow: password → OTP.

**Step 1 — Send credentials**

```
POST /api/admin/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "AdminPass123!"
}
```

Response `data`:
```json
{ "message": "An OTP has been sent to your admin email." }
```

**Step 2 — Verify OTP**

```
POST /api/admin/auth/verify-otp
Content-Type: application/json

{
  "email": "admin@example.com",
  "otp": "123456"
}
```

Response `data`:
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "user": {
    "id": "uuid",
    "name": "Admin Name",
    "email": "admin@example.com",
    "role": "admin",
    "kyc_status": "verified"
  }
}
```

Store both tokens. The OTP expires in **10 minutes**. If OTP entry times out, restart from Step 1.

### 3.2 User Login (Two-Step — same pattern)

```
POST /api/auth/login          → sends OTP
POST /api/auth/verify-otp     → returns accessToken + refreshToken + user
```

### 3.3 User Registration

```
POST /api/auth/register
Content-Type: application/json

{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348000000000",
  "password": "Password123!"
}
```

Response `201`:
```json
{
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "username": "jane_doe_1a2b",
    "email": "jane@example.com",
    "phone": "+2348000000000",
    "email_verified": false,
    "kyc_status": "unverified",
    "role": "user",
    "is_suspended": false,
    "created_at": "..."
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

A verification email is automatically sent. The user can trade immediately after KYC verification.

### 3.4 Token Lifetimes

| Token | Admin | User |
|-------|-------|------|
| Access token | 8 hours | 30 minutes |
| Refresh token | 30 days | 30 days |

---

## 4. Token Management

### Attaching the Token

Send the access token as a Bearer header on every protected request:

```
Authorization: Bearer <accessToken>
```

### Refreshing

When a request returns `401`, call:

```
POST /api/auth/refresh-token
Content-Type: application/json

{ "refreshToken": "<refreshToken>" }
```

Response `data`:
```json
{
  "accessToken": "<new_jwt>",
  "refreshToken": "<new_jwt>"
}
```

Retry the original request with the new token. If refresh also returns `401`, the session has expired — redirect to login.

### Logout

```
POST /api/auth/logout
Authorization: Bearer <accessToken>
```

Call this on logout to invalidate the server-side session (if applicable). Clear tokens from storage regardless.

---

## 5. Admin Portal — All Endpoints

All routes below are prefixed with `/api/admin` and require:
```
Authorization: Bearer <adminAccessToken>
```

Unless noted otherwise, routes marked **[SA]** require `role = super_admin`.

### 5.1 Auth (no token required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/auth/login` | Step 1: submit email + password, triggers OTP |
| POST | `/admin/auth/verify-otp` | Step 2: submit OTP, receive tokens |
| GET | `/admin/invites/accept?token=<token>` | Validate an invite link |
| POST | `/admin/invites/setup` | Complete account setup from invite |

### 5.2 Admin Governance [SA]

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/admins` | List all admins |
| POST | `/admin/invites` | Invite a new admin (rate-limited) |
| POST | `/admin/admins/:id/remove` | Remove an admin |
| POST | `/admin/admins/:id/upgrade` | Upgrade admin → super admin |

**Invite body:**
```json
{ "email": "newadmin@example.com", "name": "Jane Doe" }
```

### 5.3 User Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users` | Paginated list of all users |
| GET | `/admin/users/:id` | Full user profile + wallets |
| POST | `/admin/users/:id/suspend` | Suspend a user |
| POST | `/admin/users/:id/reinstate` | Reinstate a suspended user |

Query params for list: `?page=1&limit=20`

### 5.4 Admin Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/profile` | Own profile |
| POST | `/admin/profile/picture` | Upload profile picture (multipart/form-data, field: `file`, max 10 MB) |

### 5.5 KYC Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/kyc` | Paginated KYC submissions (`?page&limit&status`) |
| POST | `/admin/kyc/:id/approve` | Approve a KYC submission |
| POST | `/admin/kyc/:id/reject` | Reject a KYC submission |

**Reject body:**
```json
{ "reason": "Document was blurry" }
```

### 5.6 Deposit Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/deposits` | Paginated deposit list (`?page&limit`) |
| POST | `/admin/deposits/:id/approve` | Approve a foreign deposit |
| POST | `/admin/deposits/:id/reject` | Reject a deposit |
| POST | `/admin/deposits/:id/verify-flutterwave` | Verify an NGN Flutterwave deposit |

**Reject body:**
```json
{ "reason": "Proof of payment does not match amount" }
```

### 5.7 Disputes Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/disputes` | Paginated dispute list |
| POST | `/admin/disputes/:id/resolve` | Resolve a dispute with a resolution note |

**Resolve body:**
```json
{ "resolution_note": "Funds returned to buyer after seller failed to respond." }
```

### 5.8 Admin Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/logs` | Paginated admin action log |

Super admins see all logs; regular admins see only their own.

### 5.9 Analytics & Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard` | High-level platform snapshot + 7-day charts |
| GET | `/admin/analytics/impact` | Investor-facing impact summary |
| GET | `/admin/analytics/metrics` | Full comprehensive metrics (see §7) |
| GET | `/admin/trades` | All trades with buyer/seller names (paginated) |
| GET | `/admin/transactions` | All ledger transactions (paginated) |

**Metrics query params** (all optional):

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO 8601 datetime | auto-anchored | Start of the **growth chart** window only. Defaults to a clean boundary: 6 days ago (day), 3 weeks ago (week), 11 months ago (month) |
| `to` | ISO 8601 datetime | now | End of the growth chart window |
| `launch_date` | ISO 8601 datetime | `2023-10-01T00:00:00Z` | Reference point for `users_at_launch` only |
| `granularity` | `day` \| `week` \| `month` | `month` | Controls growth chart bucket size and label format |

> **Important:** `from`/`to` **only** affect `growth.user_growth_monthly` and `growth.trade_volume_monthly`. Every other metric (users, KYC, trades, P2P, escrow, deposits) is always all-time.

**Recommended param combinations for the growth chart time-range picker:**

| UI Button | Params to send | Buckets returned |
|-----------|----------------|-----------------|
| Last 7 days | `granularity=day` | 7 day buckets (Mon–Sun labels) |
| Last 4 weeks | `granularity=week` | 4 week buckets (Week 1–4 labels) |
| Last 12 months | `granularity=month` | 12 month buckets (Jan 26… labels) |
| Custom range | `granularity=day|week|month&from=<ISO>&to=<ISO>` | variable |

---

## 6. User-Facing Endpoints Reference

All protected routes below require `Authorization: Bearer <accessToken>`. Routes marked **[KYC]** additionally require the user to have `kyc_status = "verified"`.

### 6.1 Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register new user (auto-creates 4 wallets) |
| GET | `/auth/verify-email?token=` | No | Verify email from link |
| POST | `/auth/login` | No | Step 1: send OTP |
| POST | `/auth/verify-otp` | No | Step 2: verify OTP → tokens |
| POST | `/auth/refresh-token` | No | Exchange refresh token for new access token |
| POST | `/auth/logout` | Yes | Invalidate session |
| GET | `/auth/me` | Yes | Get current user profile |
| POST | `/auth/forgot-password` | No | Send password reset email |
| POST | `/auth/reset-password` | No | Reset password using token from email |

**`POST /auth/verify-otp` response `data`:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "uuid",
    "name": "Jane Doe",
    "username": "jane_doe_1a2b",
    "email": "jane@example.com",
    "role": "user",
    "kyc_status": "unverified",
    "is_suspended": false,
    "profile_picture_url": null,
    "created_at": "..."
  }
}
```

### 6.2 Account Management

All account routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/account/username` | Change username (3–30 chars, letters/numbers/underscores) |
| POST | `/account/transaction-pin/set` | Set or update 6-digit transaction PIN |
| POST | `/account/profile/picture` | Upload avatar (multipart/form-data, field: `file`, max 10 MB) |
| POST | `/account/delete/initiate` | Step 1 account deletion — verifies password, sends OTP |
| POST | `/account/delete/confirm` | Step 2 account deletion — verifies password + OTP |
| POST | `/account/email-change/initiate` | Step 1 email change — verifies password, sends OTP to new email |
| POST | `/account/email-change/confirm` | Step 2 email change — verifies OTP |

**`PUT /account/username` body:**
```json
{ "username": "new_username_123" }
```

**`POST /account/transaction-pin/set` body:**
```json
{ "pin": "123456", "confirm_pin": "123456" }
```

**`POST /account/delete/initiate` body:**
```json
{ "password": "Password123!" }
```

**`POST /account/delete/confirm` body:**
```json
{ "password": "Password123!", "otp": "123456" }
```

**`POST /account/email-change/initiate` body:**
```json
{ "new_email": "new@example.com", "password": "Password123!" }
```

**`POST /account/email-change/confirm` body:**
```json
{ "new_email": "new@example.com", "otp": "123456" }
```

> **Note:** There is no `PUT /account/profile` name-update endpoint. Username changes use `PUT /account/username`. There is no separate PIN change endpoint — `POST /account/transaction-pin/set` overwrites the existing PIN.

### 6.3 Wallets

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/wallets` | Yes | List all 4 wallets (NGN, GBP, USD, CAD) |
| GET | `/wallets/:currency` | Yes | Get single wallet by currency code |

**`GET /wallets` response `data`:**
```json
{
  "wallets": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "currency": "NGN",
      "balance": "50000.00",
      "locked_balance": "0.00",
      "escrow_balance": "0.00",
      "created_at": "..."
    }
  ]
}
```

> `balance` = spendable. `locked_balance` = funds currently in escrow (not spendable). `escrow_balance` = seller's foreign currency locked for active SELL sabits.

### 6.4 Ledger (Transaction History)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/ledger` | Yes | Paginated ledger entries across all wallets |
| GET | `/ledger/:walletId` | Yes | Paginated ledger entries for a specific wallet |

**`GET /ledger` query params:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO 8601 datetime | Filter entries from this date |
| `to` | ISO 8601 datetime | Filter entries up to this date |
| `type` | LedgerType enum | Filter by entry type |
| `currency` | `NGN`\|`GBP`\|`USD`\|`CAD` | Filter by currency |
| `page` | integer | Default: 1 |
| `limit` | integer | Default: 20 |

**LedgerType values:** `deposit`, `withdrawal`, `trade_debit`, `trade_credit`, `escrow_hold`, `escrow_release`, `reversal`, `adjustment`

**`GET /ledger` response `data`:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "wallet_id": "uuid",
      "type": "deposit",
      "amount": "5000.00",
      "currency": "NGN",
      "reference": "DEP-0001",
      "related_id": "uuid",
      "created_at": "..."
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### 6.5 Deposits

| Method | Path | Auth | KYC | Description |
|--------|------|------|-----|-------------|
| POST | `/deposits/ngn/initiate` | Yes | Required | Initiate NGN deposit via Flutterwave |
| POST | `/deposits/foreign` | Yes | Required | Submit manual foreign deposit (multipart) |
| GET | `/deposits` | Yes | No | List user's deposits (paginated) |
| GET | `/deposits/:id` | Yes | No | Get a single deposit |
| POST | `/deposits/:id/cancel` | Yes | No | Cancel an `initiated` deposit |

**`POST /deposits/ngn/initiate` body:**
```json
{ "amount": "5000.00" }
```
Response `data.deposit` contains a `payment_link` field — redirect the user to this URL to complete payment on Flutterwave's hosted page.

**`POST /deposits/foreign` body** (multipart/form-data):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `currency` | `GBP`\|`USD`\|`CAD` | Yes | Target currency |
| `amount` | string | Yes | Amount deposited (e.g. `"100.00"`) |
| `proof` | file (image/PDF) | Yes | Proof-of-payment screenshot, max 10 MB |

**Deposit status values:** `initiated` → `pending_review` → `completed` / `rejected` / `failed` / `expired`

**`GET /deposits` response `data`:**
```json
{
  "deposits": [
    {
      "id": "uuid",
      "reference": "DEP-0001",
      "user_id": "uuid",
      "currency": "NGN",
      "amount": "5000.00",
      "provider": "flutterwave",
      "provider_reference": "FLW-xxx",
      "proof_url": null,
      "status": "completed",
      "rejection_reason": null,
      "reviewed_at": "...",
      "created_at": "..."
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

### 6.6 Withdrawals

Requires KYC verification. Withdrawals are manually processed — funds are immediately debited from the wallet and the request is queued for admin review.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/withdrawals/request` | Yes [KYC] | Request a withdrawal to a saved beneficiary |
| GET | `/withdrawals` | Yes [KYC] | List user's withdrawals (paginated) |
| GET | `/withdrawals/:id` | Yes [KYC] | Get a single withdrawal |

**`POST /withdrawals/request` body:**
```json
{
  "beneficiary_id": "uuid",
  "amount": "10000.00",
  "pin": "123456"
}
```

**Withdrawal status values:** `requested` → `approved` → `processing` → `completed` / `failed`

**`GET /withdrawals` response `data`:**
```json
{
  "withdrawals": [
    {
      "id": "uuid",
      "reference": "WDR-0001",
      "user_id": "uuid",
      "beneficiary_id": "uuid",
      "currency": "NGN",
      "amount": "10000.00",
      "status": "requested",
      "created_at": "..."
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 20
}
```

### 6.7 Beneficiaries

Saved bank accounts for withdrawals. Requires KYC verification.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/beneficiaries` | Yes [KYC] | Add a new beneficiary |
| GET | `/beneficiaries` | Yes [KYC] | List saved beneficiaries |
| PUT | `/beneficiaries/:id/set-default` | Yes [KYC] | Set default beneficiary for a currency |
| DELETE | `/beneficiaries/:id` | Yes [KYC] | Delete a beneficiary |

**`POST /beneficiaries` body:**
```json
{
  "currency": "NGN",
  "bank_name": "First Bank",
  "account_name": "Jane Doe",
  "account_number": "1234567890",
  "sort_code": "optional, UK only",
  "iban": "optional, EU accounts"
}
```

**`GET /beneficiaries` response `data`:**
```json
{
  "beneficiaries": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "currency": "NGN",
      "bank_name": "First Bank",
      "account_name": "Jane Doe",
      "account_number": "1234567890",
      "sort_code": null,
      "iban": null,
      "is_default": true,
      "created_at": "..."
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 50
}
```

### 6.8 KYC Verification

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/kyc/upload` | Yes | Submit KYC documents (multipart) |
| GET | `/kyc/status` | Yes | Get own KYC status |

**`POST /kyc/upload` body** (multipart/form-data):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document` | file | Yes | Government ID (passport, national ID, driver's licence) |
| `selfie` | file | Yes | Selfie/photo of the user |

Both fields accept image files up to 10 MB. Document type is inferred from the uploaded file.

### 6.9 Exchange Rates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rates` | No | Latest rates + 24h change + P2P market spread |
| GET | `/rates/history/:pair` | No | Hourly rate history for a pair (last 30 days) |

**`GET /rates` response `data`:**
```json
{
  "rates": [
    {
      "pair": "GBP/NGN",
      "rate": "1950.00",
      "source": "open_exchange_rates",
      "updated_at": "...",
      "change_24h_pct": 0.52,
      "p2p": {
        "best_sell_rate": "1940.00",
        "best_buy_rate": "1960.00",
        "active_sell_listings": 12,
        "active_buy_listings": 4
      }
    }
  ]
}
```

> `change_24h_pct` is `null` if no historical record exists for 24h ago. `p2p.best_sell_rate` / `best_buy_rate` are `null` if no active listings for that currency.

**`GET /rates/history/:pair`** — pair can be `GBP-NGN` or `GBP/NGN` (both accepted).

Response `data`:
```json
{
  "pair": "GBP/NGN",
  "history": [
    { "bucket": "2026-04-01T10:00:00.000Z", "rate": "1945.00" }
  ]
}
```

### 6.10 Conversions

Requires KYC verification. Converts between currencies using live exchange rates.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/conversions/quote` | Yes [KYC] | Get a conversion quote (valid 60 seconds) |
| POST | `/conversions/execute` | Yes [KYC] | Execute a conversion (immediately debit/credit) |

**Request body (both endpoints):**
```json
{
  "from": "GBP",
  "to": "NGN",
  "amount": "100.00"
}
```

**`POST /conversions/quote` response `data`:**
```json
{
  "quote": {
    "from": "GBP",
    "to": "NGN",
    "amount": "100.00",
    "resultAmount": "194500.00",
    "rate": "1945.00",
    "expiresAt": "..."
  }
}
```

### 6.11 Sabits (P2P Listings)

The marketplace. `GET` list and single are **public** (no auth). Creating and cancelling require auth + KYC.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sabits` | No | Browse active listings (paginated + filtered) |
| GET | `/sabits/:id` | No | Get a single listing |
| POST | `/sabits` | Yes [KYC] | Create a new listing |
| POST | `/sabits/:id/cancel` | Yes [KYC] | Cancel own active listing |

**`GET /sabits` query params:**

| Param | Type | Description |
|-------|------|-------------|
| `type` | `SELL`\|`BUY` | Filter by listing type |
| `currency` | `GBP`\|`USD`\|`CAD` | Filter by currency |
| `page` | integer | Default: 1 |
| `limit` | integer | Default: 20 |

**`POST /sabits` body:**
```json
{
  "type": "SELL",
  "currency": "GBP",
  "amount": "500.00",
  "rate_ngn": "1950.00"
}
```

> - `type = "SELL"`: You are selling foreign currency for NGN. Your foreign currency wallet is locked when the listing is created.
> - `type = "BUY"`: You are buying foreign currency with NGN. Your NGN wallet is locked when the listing is created.
> - Creating a SELL sabit requires a transaction PIN to be set first.
> - `currency` must be `GBP`, `USD`, or `CAD` — not `NGN` (NGN is always the quote currency).

**`GET /sabits` response `data`:**
```json
{
  "sabits": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "type": "SELL",
      "currency": "GBP",
      "amount": "500.00",
      "available_amount": "450.00",
      "rate_ngn": "1950.00",
      "status": "active",
      "user_username": "jane_doe",
      "user_profile_picture": null,
      "created_at": "..."
    }
  ],
  "total": 30,
  "page": 1,
  "limit": 20
}
```

### 6.12 Trades

Standard trade flow (for any active sabit — BUY or SELL type):

1. Buyer calls `POST /trades/initiate` with `sabit_id`, `amount`, and `pin` → trade enters `escrowed` status
2. Both parties' funds are locked. Seller is notified by email and in-app notification.
3. Seller calls `PUT /trades/:id/seller-confirm` with `pin` within **30 minutes** → trade completes and funds settle.
4. If seller does NOT confirm within 30 minutes → trade auto-cancels when seller tries to confirm, and the buyer's funds are returned.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/trades` | Yes [KYC] | List user's trades (as buyer or seller) |
| GET | `/trades/:id` | Yes [KYC] | Get a single trade |
| POST | `/trades/initiate` | Yes [KYC] | Initiate a trade against a sabit |
| PUT | `/trades/:id/seller-confirm` | Yes [KYC] | Seller confirms and settles with PIN |

**`POST /trades/initiate` body:**
```json
{
  "sabit_id": "uuid",
  "amount": "100.00",
  "pin": "123456"
}
```

**`PUT /trades/:id/seller-confirm` body:**
```json
{ "pin": "123456" }
```

**Trade status flow:** `escrowed` → `completed` (or `cancelled` on timeout / `disputed` if a dispute is raised)

**`GET /trades` query params:** `?page=1&limit=20&status=<TradeStatus>`

**`GET /trades` response `data`:**
```json
{
  "trades": [
    {
      "id": "uuid",
      "sabit_id": "uuid",
      "buyer_id": "uuid",
      "seller_id": "uuid",
      "currency": "GBP",
      "amount": "100.00",
      "rate_ngn": "1950.00",
      "total_ngn": "195000.00",
      "reference": "TXN-0001",
      "status": "completed",
      "buyer_pin_verified": true,
      "seller_pin_verified": true,
      "pin_expires_at": null,
      "completed_at": "...",
      "bid_id": null,
      "buyer_name": "Jane Doe",
      "seller_name": "John Smith",
      "created_at": "..."
    }
  ]
}
```

### 6.13 Bids (Counter-Offers)

Bids are counter-offers on **SELL sabits only**. A buyer proposes a lower rate than the listing rate.

**Bid flow:**
1. Buyer calls `POST /bids` with `sabit_id`, `amount`, `proposed_rate_ngn`, and `pin` → buyer's NGN is locked at the proposed rate, seller notified.
2. Seller either:
   - `PUT /bids/:id/accept` with `pin` → trade immediately completes and settles (no separate seller-confirm step)
   - `PUT /bids/:id/reject` with `pin` → buyer's NGN is released back
3. If seller does not respond, buyer can `PUT /bids/:id/withdraw` → buyer's NGN released back.
4. Bids expire after **24 hours** — buyer's funds automatically released.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/bids` | Yes [KYC] | Place a bid on a SELL listing |
| GET | `/bids/mine` | Yes | Bids I placed (as buyer) |
| GET | `/bids/received` | Yes | Bids received on my listings (as seller) |
| PUT | `/bids/:id/accept` | Yes | Accept a bid (Seller only) — immediately settles |
| PUT | `/bids/:id/reject` | Yes | Reject a bid (Seller only) — releases buyer funds |
| PUT | `/bids/:id/withdraw` | Yes | Withdraw a pending bid (Buyer only) — releases funds |

**`POST /bids` body:**
```json
{
  "sabit_id": "uuid",
  "amount": "100.00",
  "proposed_rate_ngn": "1920.00",
  "pin": "123456"
}
```

> `proposed_rate_ngn` must be **strictly lower** than the listing's `rate_ngn`. A bid at or above the listing rate is rejected with `BID_RATE_TOO_HIGH`.

**`PUT /bids/:id/accept` body:**
```json
{ "pin": "123456" }
```

**`PUT /bids/:id/reject` body:**
```json
{
  "pin": "123456",
  "reason": "Rate too low for current market."
}
```

**`GET /bids/mine` / `GET /bids/received` query params:** `?page=1&limit=20&status=<BidStatus>`

**Bid status values:** `pending` → `accepted` / `rejected` / `withdrawn` / `expired`

**`GET /bids/mine` response `data`:**
```json
{
  "bids": [
    {
      "id": "uuid",
      "reference": "BID-0001",
      "sabit_id": "uuid",
      "buyer_id": "uuid",
      "seller_id": "uuid",
      "currency": "GBP",
      "amount": "100.00",
      "proposed_rate_ngn": "1920.00",
      "original_rate_ngn": "1950.00",
      "total_ngn_at_bid_rate": "192000.00",
      "status": "pending",
      "buyer_pin_verified": true,
      "seller_responded_at": null,
      "rejection_reason": null,
      "expires_at": "...",
      "created_at": "..."
    }
  ]
}
```

### 6.14 Disputes

Can be raised on a trade while it is in `escrowed` or `confirmed` status (not after completion or cancellation).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/disputes/raise` | Yes [KYC] | Raise a dispute on a trade |
| GET | `/disputes` | Yes [KYC] | List user's disputes (paginated) |
| GET | `/disputes/:id` | Yes [KYC] | Get a single dispute |

**`POST /disputes/raise` body:**
```json
{
  "trade_id": "uuid",
  "reason": "The seller has not responded after I made payment. (min 20 chars)"
}
```

**Dispute status values:** `open` → `resolved` / `closed`

**`GET /disputes` response `data`:**
```json
{
  "disputes": [
    {
      "id": "uuid",
      "trade_id": "uuid",
      "raised_by_id": "uuid",
      "reason": "Seller did not respond...",
      "status": "open",
      "resolution_note": null,
      "trade_reference": "TXN-0001",
      "trade_currency": "GBP",
      "trade_amount": "100.00",
      "trade_total_ngn": "195000.00",
      "trade_status": "disputed",
      "created_at": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### 6.15 Ratings

Users can leave a rating for their counterparty after a trade is marked `completed`. One rating per trade per user.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/ratings/user/:id` | No | Get a user's reputation summary |
| POST | `/ratings` | Yes [KYC] | Submit a rating for a completed trade |

**`POST /ratings` body:**
```json
{
  "trade_id": "uuid",
  "score": 5,
  "comment": "Fast and trustworthy seller."
}
```

> `score` is an integer from **1 to 5**. `comment` is optional (max 500 chars).

**`GET /ratings/user/:id?page=1&limit=20` response `data`:**
```json
{
  "reputation": {
    "average_score": 4.85,
    "total_reviews": 42
  },
  "recent_reviews": [
    {
      "id": "uuid",
      "score": 5,
      "comment": "Great seller, very fast.",
      "created_at": "...",
      "rater_name": "Jane Doe"
    }
  ],
  "total": 38,
  "page": 1,
  "limit": 20
}
```

> `total` = number of reviews with comments. `reputation.total_reviews` = all reviews including those without comments.

### 6.16 Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | Yes | List notifications (`?page&limit`) |
| POST | `/notifications/mark-all-read` | Yes | Mark all as read |
| PATCH | `/notifications/:id/read` | Yes | Mark one notification as read |

**`GET /notifications` response `data`:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "title": "Trade Completed",
      "message": "Your trade TXN-0001 has been settled.",
      "type": "success",
      "status": "unread",
      "related_id": "uuid",
      "created_at": "..."
    }
  ]
}
```

**Notification types:** `info` | `success` | `warning` | `error`
**Notification status:** `unread` | `read`

---

## 7. Metrics Analytics — Full Response Schema

`GET /api/admin/analytics/metrics`

**Important notes before rendering:**
- All financial amounts (`lifetime_ngn_volume`, `total_volume`, `locked_value`, etc.) are **numeric strings** (e.g. `"2830000000.00"`). Convert to `Number()` only for display formatting — never for arithmetic.
- `avg_verification_hours`, `median_verification_hours`, and `avg_settlement_hours` can be **`null`** when no qualifying records exist. Always guard against null before rendering.
- `by_currency` arrays can be **empty** if no trades/deposits exist for that currency yet.

```jsonc
{
  "success": true,
  "data": {

    "generated_at": "2026-04-03T12:00:00.000Z",
    "window": {
      "from": "1970-01-01T00:00:00.000Z",
      "to": "2026-04-03T12:00:00.000Z"
    },
    "launch_date": "2023-10-01T00:00:00.000Z",

    "granularity": "month",               // echoes back the requested granularity

    // ── USERS (all-time snapshot — never window-scoped) ────────────────
    "users": {
      "total_registered": 1182,           // all-time, all non-deleted users
      "total_active": 1005,               // KYC-verified AND not suspended (able to trade)
      "total_suspended": 22,
      "users_at_launch": 40,              // users who existed before launch_date param
      "monthly_active_users": 450,        // rolling last-30-day ledger activity
      "kyc": {
        "verified": 1005,
        "verified_pct": 85.02,            // percentage of total_registered
        "pending": 130,
        "rejected": 20,
        "unverified": 27
      }
    },

    // ── KYC ────────────────────────────────────────────────────────────
    "kyc": {
      "total_submissions": 1235,          // all attempts, all statuses
      "verified_submissions": 1005,
      "rejected_submissions": 177,
      "pending_submissions": 53,
      "avg_verification_hours": 0.08,     // ~4.87 minutes — null if no reviewed records
      "median_verification_hours": 0.08,
      "avg_verification_hours_note": null, // non-null string only when avg is null
      "dropoff": {
        "total_users": 1182,
        "never_submitted": 25,            // registered but never uploaded any document
        "dropoff_rate_pct": 2.11
      },
      "first_attempt": {
        "total_submitted": 1157,
        "first_attempt_verified": 1100,
        "first_attempt_rejected": 53,
        "first_attempt_pending": 4,
        "success_rate_pct": 95.07         // % whose FIRST submission was approved
      }
    },

    // ── TRADES ─────────────────────────────────────────────────────────
    "trades": {
      "total_initiated": 12815,
      "total_completed": 12500,
      "total_cancelled": 315,
      "total_disputed": 87,
      "success_rate_pct": 97.54,
      "cancellation_rate_pct": 2.46,
      "lifetime_ngn_volume": "2830000000.00",  // always a string
      "avg_trade_size_ngn": "226400.00",
      "avg_settlement_hours": 0.73,            // null if no completed trades
      "by_currency": [
        {
          "currency": "GBP",
          "total_trades": 4200,
          "completed_trades": 4100,
          "cancelled_trades": 90,
          "disputed_trades": 10,
          "lifetime_ngn_volume": "1020000000.00",
          "lifetime_foreign_volume": "680000.00",
          "avg_trade_size_ngn": "248780.49",
          "avg_settlement_hours": "0.71"
        }
        // ... USD, CAD entries follow same shape
      ]
    },

    // ── P2P / SABITS ───────────────────────────────────────────────────
    "p2p": {
      "active_listings": 30,              // live snapshot — currently open sabits
      "completed_listings": 12450,
      "cancelled_listings": 620,
      "total_sellers": 890,
      "total_buyers": 720,
      "repeat_traders": 450,
      "users_who_traded": 800,
      "repeat_rate_pct": 56.25,
      "dispute_rate_pct": 0.696,
      "disputes": {
        "total": 87,
        "open": 12,
        "resolved": 75
      }
    },

    // ── ESCROW ─────────────────────────────────────────────────────────
    // lifetime_volume_ngn = completed + escrowed + disputed (all-time historical)
    // current_volume_ngn  = escrowed only (live snapshot — what is locked right now)
    // trades.lifetime_ngn_volume = completed only (settled P2P volume)
    "escrow": {
      "lifetime_volume_ngn": "2999805000.00", // all-time NGN that passed through escrow
      "current_volume_ngn": "4600000.00",     // NGN locked in escrow right now (live)
      "completion_rate_pct": 97.54,           // completed / (completed + cancelled)
      "timeout_rate_pct": 2.46,              // cancelled / total trades
      "currently_escrowed_trades": 18,        // live count of in-flight trades
      "live_tvl_by_currency": [              // seller wallet escrow_balance per currency
        { "currency": "GBP", "locked_value": "1256.09" },
        { "currency": "USD", "locked_value": "1234.39" },
        { "currency": "CAD", "locked_value": "1652.54" }
      ]
    },

    // ── DEPOSITS ───────────────────────────────────────────────────────
    // Tally rule: total_deposits = completed + rejected + pending +
    //             initiated + failed + expired
    // total_volume = SUM of completed deposits only (not all statuses)
    "deposits": {
      "by_currency": [
        {
          "currency": "NGN",
          "total_deposits": 700,
          "completed_deposits": 630,
          "rejected_deposits": 28,
          "pending_deposits": 42,
          "initiated_deposits": 0,   // Flutterwave deposits awaiting webhook confirmation
          "failed_deposits": 0,      // payment provider returned failure
          "expired_deposits": 0,     // deposit window timed out before confirmation
          "total_volume": "91000000.00"  // completed deposits only
        }
        // GBP, USD, CAD follow same shape (manual foreign deposits)
      ]
    },

    // ── GROWTH ─────────────────────────────────────────────────────────
    // ── GROWTH (ONLY section affected by from/to/granularity params) ──
    // Labels by granularity:
    //   day   → "Mon" … "Sun"  (always 7 buckets)
    //   week  → "Week 1" … "Week 4"  (always 4 buckets)
    //   month → "Jan 26", "Feb 26" …  (always 12 buckets)
    // Arrays are sorted oldest → newest. Always render in array order.
    "growth": {
      "user_growth_monthly": [
        { "label": "Jan 26", "new_users": 95, "cumulative_users": 950 },
        { "label": "Feb 26", "new_users": 110, "cumulative_users": 1060 }
        // ... oldest first
      ],
      // ngn_volume           = new volume this period only
      // cumulative_ngn_volume = running total from all of history through this period
      //   → use cumulative_ngn_volume for the growth line so the current incomplete
      //     month never shows ₦0 (it carries forward the prior total automatically)
      "trade_volume_monthly": [
        { "label": "Jan 26", "completed_trades": 877, "ngn_volume": "217995000.00", "cumulative_ngn_volume": "2559855000.00" },
        { "label": "Feb 26", "completed_trades": 832, "ngn_volume": "201040000.00", "cumulative_ngn_volume": "2760895000.00" },
        { "label": "Mar 26", "completed_trades": 1009, "ngn_volume": "233740000.00", "cumulative_ngn_volume": "2994635000.00" },
        { "label": "Apr 26", "completed_trades": 0, "ngn_volume": "0.00", "cumulative_ngn_volume": "2994745000.00" }
        // ↑ Apr shows ngn_volume ≈ ₦0 (only 4 days in, no completed trades yet)
        //   but cumulative_ngn_volume = ₦2.99B (correct running total)
        // ... oldest first
      ]
    },

    // ── PLATFORM (static constants) ────────────────────────────────────
    "platform": {
      "pin_confirmation_window_minutes": 30,
      "bid_expiry_hours": 24,
      "background_jobs_count": 4,
      "supported_currencies": ["NGN", "GBP", "USD", "CAD"],
      "kyc_process": "manual_admin_review",
      "deposit_ngn_provider": "flutterwave",
      "deposit_foreign_process": "manual_proof_upload"
    }

  },
  "meta": {},
  "error": null
}
```

---

## 8. Dashboard Stats — Response Schema

`GET /api/admin/dashboard`

```jsonc
{
  "users": { "total": "1182", "active": "1160", "suspended": "22" },
  "kyc": { "total": "1235", "pending": "53", "verified": "1005", "rejected": "177" },
  "marketplace": {
    "sabits": { "total": "630", "active": "30", "completed": "600" },
    "disputes": { "total": "87", "open": "12", "resolved": "75" }
  },
  "financials": {
    "depositVolumes":    [{ "currency": "NGN", "total_volume": "182000000.00" }],
    "withdrawalVolumes": [{ "currency": "NGN", "total_volume": "91000000.00" }],
    "tradeVolumes": [
      { "currency": "GBP", "total_foreign_volume": "680000.00", "total_ngn_volume": "1020000000.00", "total_trades": "4100" }
    ],
    "escrowTVL": [{ "currency": "GBP", "total_locked": "1250.00" }]
  },
  "pendingDeposits": [
    { "id": "uuid", "amount": "50000.00", "currency": "NGN", "rejection_reason": null, "created_at": "..." }
  ],
  "recentKyc": [
    { "id": "uuid", "status": "pending", "document_type": "passport", "user_name": "John Doe", "user_username": "johndoe", "user_profile_picture": null }
  ],
  "charts": {
    "kycSubmissions": [{ "label": "Mon", "value": "4" }, ...],
    "deposits":       [{ "label": "Mon", "value": "12" }, ...],
    "trades":         [{ "label": "Mon", "value": "87" }, ...]
  }
}
```

> Note: All numeric fields from the DB arrive as **strings** in the dashboard response (raw SQL output). Cast with `Number()` for display.

---

## 9. Impact Analytics — Response Schema

`GET /api/admin/analytics/impact`

```jsonc
{
  "scale": {
    "allTimeLedgerVolume": [
      { "currency": "NGN", "total_processed": "4500000000.00" },
      { "currency": "GBP", "total_processed": "1400000.00" }
    ]
  },
  "traction": {
    "userGrowth30Days": {
      "recent_count": "110",
      "prev_count": "95",
      "growth_percentage": "15.79"
    }
  },
  "trustAndSafety": {
    "tradeSafety": {
      "total_trades": "12815",
      "successful_trades": "12500",
      "disputed_trades": "87",
      "dispute_rate_percentage": "0.68"
    }
  },
  "efficiency": {
    "adminActions30Days": "342"
  }
}
```

---

## 10. Pagination

Any list endpoint that accepts pagination uses these query params:

| Param | Default | Description |
|-------|---------|-------------|
| `page` | `1` | 1-indexed page number |
| `limit` | `20` | Items per page (max varies by endpoint) |

Most list endpoints return `total`, `page`, and `limit` alongside the data array so you can render "Page X of Y" and know when to disable the "next" button.

---

## 11. Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error (Zod) or business rule violation |
| 401 | Missing or invalid token / wrong credentials |
| 403 | Insufficient role (e.g., non-super-admin hitting SA-only route) |
| 404 | Resource not found |
| 409 | Conflict (e.g., username already taken, email already registered) |
| 429 | Rate limit exceeded (invite endpoint) |
| 500 | Internal server error |

### Error Codes (machine-readable)

| code | Trigger |
|------|---------|
| `INVALID_ADMIN_CREDENTIALS` | Wrong email or password (admin) |
| `INVALID_CREDENTIALS` | Wrong email or password (user) |
| `ACCOUNT_SUSPENDED` | Account is suspended |
| `ACCOUNT_DELETED` | Account was soft-deleted |
| `INVALID_OTP` | Wrong or expired OTP |
| `UNAUTHORIZED` | Missing Bearer token |
| `FORBIDDEN` | Correct token, insufficient role |
| `KYC_NOT_VERIFIED` | KYC verification required for this action |
| `NOT_FOUND` | Entity does not exist |
| `VALIDATION_ERROR` | Zod schema rejection |
| `INVALID_PIN` | Transaction PIN is incorrect |
| `PIN_EXPIRED` | 30-minute trade confirmation window expired |
| `SELF_TRADE_NOT_ALLOWED` | Cannot trade against your own listing |
| `INSUFFICIENT_BALANCE` | Wallet balance too low |
| `INSUFFICIENT_SABIT_AMOUNT` | Trade amount exceeds listing available amount |
| `INVALID_TOKEN` | JWT or reset token is invalid/expired |
| `INVALID_REFRESH_TOKEN` | Refresh token invalid/expired |
| `USERNAME_TAKEN` | Username already in use |
| `BID_RATE_TOO_HIGH` | Bid rate must be lower than listing rate |
| `DUPLICATE_BID` | Already have a pending bid on this listing |
| `BID_EXPIRED` | Bid expired (24h elapsed) |
| `ALREADY_DISPUTED` | Dispute already open for this trade |
| `ALREADY_RATED` | Already rated this trade |
| `APP_ERROR` | General business logic error — read `message` |

### Recommended Frontend Pattern

```typescript
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: ApiResponse<T> = await res.json();
  if (!body.success) {
    throw new ApiError(body.error!.code, body.error!.message, res.status);
  }
  return body.data!;
}
```

---

## 12. Chart & UI Recommendations Per Metric

### Admin Dashboard (`/admin/dashboard`)

| Data | Recommended Component |
|------|-----------------------|
| User counts (total/active/suspended) | Stat cards (3-up) |
| KYC counts (pending/verified/rejected) | Donut / pie chart or stat cards |
| Last 7 days KYC submissions | Bar chart (7 bars, day labels) |
| Last 7 days deposits | Bar chart |
| Last 7 days completed trades | Bar chart |
| Pending deposits list | Table with "Approve / Reject" actions |
| Recent KYC queue | Table with avatar + status badge |
| Escrow TVL | Stat cards per currency |

### Metrics Dashboard (`/admin/analytics/metrics`)

#### User Section
| Metric | Component |
|--------|-----------|
| total_registered / total_active / total_suspended | Stat cards (3-up, all-time) |
| monthly_active_users | Stat card — label clearly as "Active last 30 days" |
| users_at_launch | Stat card — show alongside total_registered for context |
| KYC verified % | Circular progress / gauge |
| kyc.verified / pending / rejected / unverified | Horizontal stacked bar or donut |

#### KYC Section
| Metric | Component |
|--------|-----------|
| avg_verification_hours | Stat card (display as "X min" if < 1 hour) |
| median_verification_hours | Stat card |
| dropoff_rate_pct | Stat card with warning colour if > 10% |
| first_attempt.success_rate_pct | Circular progress |
| total_submissions breakdown | Bar chart (verified / rejected / pending) |

#### Trades Section
| Metric | Component |
|--------|-----------|
| total_initiated / completed / cancelled / disputed | Stat cards (4-up) |
| success_rate_pct | Circular gauge (target ≥ 95%) |
| lifetime_ngn_volume | Hero stat (format as "₦2.83B") |
| avg_trade_size_ngn | Stat card |
| avg_settlement_hours | Stat card (display as "X min" if < 1h) |
| by_currency breakdown | Grouped bar chart or tabbed stat cards |

#### P2P Section
| Metric | Component |
|--------|-----------|
| active_listings | Live badge / stat card |
| total_sellers / total_buyers | Stat cards |
| repeat_rate_pct | Donut (repeat vs one-time) |
| dispute_rate_pct | Stat card with colour threshold (green < 1%, amber 1–3%, red > 3%) |
| disputes.open / resolved | Progress bar or stat pair |

#### Escrow Section
| Metric | Component |
|--------|-----------|
| `lifetime_volume_ngn` | Hero stat — label "Lifetime Escrow Volume" |
| `current_volume_ngn` | Hero stat — label "Current Escrow Volume" with live pulse |
| `completion_rate_pct` | Circular gauge |
| `timeout_rate_pct` | Stat card with color threshold (green < 3%, red > 5%) |
| `currently_escrowed_trades` | Live stat card with pulse indicator |
| `live_tvl_by_currency` | Stat cards per currency — label "Live TVL" |

> Three related but distinct numbers — display all three so admins can see the full escrow picture:
> - `current_volume_ngn` — what is locked **right now** in NGN
> - `lifetime_volume_ngn` — total NGN that has ever been escrowed
> - `trades.lifetime_ngn_volume` — settled P2P volume (completed trades only)

#### Growth Section

Both series support the same time-range picker (Last 7 days / Last 4 weeks / Last 12 months / Since launch). Each bucket always has two volume fields — use the right one per chart type:

| Chart | Field to use | Why |
|-------|-------------|-----|
| "How many users joined this month?" bar chart | `new_users` | Per-period registrations |
| "Total users over time" area/line chart | `cumulative_users` | Running total — never drops to 0 |
| "Trade volume this month" bar chart | `ngn_volume` | Per-period settled volume |
| "Platform total volume over time" area/line chart | `cumulative_ngn_volume` | Running total — current month stays at prior total even with 0 new trades |

| Metric | Recommended component |
|--------|-----------|
| user_growth_monthly | Combo chart: `new_users` as bars (secondary axis), `cumulative_users` as line (primary axis) |
| trade_volume_monthly | Combo chart: `ngn_volume` as bars (secondary axis), `cumulative_ngn_volume` as line (primary axis) |

> **Why cumulative never shows ₦0:** The backend computes a `baseline` CTE that sums all trades *before* the chart window, then adds each period's volume via a window function. So even if the current month has zero new trades, `cumulative_ngn_volume` still shows the correct all-time total (e.g. ₦2.99B for April even though April has 0 trades so far).

#### Deposits Section
| Metric | Component |
|--------|-----------|
| by_currency breakdown | Grouped stats table |
| completed / pending / rejected / failed / expired / initiated | Stacked bar per currency |
| total_volume | Stat card — label as "Confirmed deposit volume" |

> `total_deposits = completed + rejected + pending + initiated + failed + expired` — all six must sum to total. `total_volume` reflects completed deposits only.

### Number Formatting Helpers

```typescript
// Format large NGN amounts for display
function formatNgn(value: string): string {
  const n = Number(value);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toFixed(2)}`;
}

// Format hours into human-readable time
function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} hrs`;
}

// Format percentage
function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}
```

---

## 13. TypeScript Types

The file `src/types/api-contracts.ts` in this repository contains full TypeScript interfaces for every API response. Copy it into your frontend project.

Key types to import:

```typescript
import type {
  ApiResponse,
  MetricsAnalyticsResponse,
  AdminDashboardResponse,
  ImpactAnalyticsResponse,
  AdminUser,
  Trade,
  TradeWithParticipants,
  Sabit,
  Bid,
  Deposit,
  KycSubmission,
  Dispute,
  Wallet,
  LedgerEntry,
  Beneficiary,
  Notification,
  Rating,
  ExchangeRate,
  ConversionQuote,
  Currency,
  TradeStatus,
  SabitStatus,
  SabitType,
  BidStatus,
  DepositStatus,
  WithdrawalStatus,
  DisputeStatus,
  KycStatus,
  LedgerType,
  NotificationType,
  NotificationStatus,
} from './api-contracts';
```

### Usage Example

```typescript
// Fetch metrics
const res = await fetch('/api/admin/analytics/metrics', {
  headers: { Authorization: `Bearer ${token}` },
});
const body: ApiResponse<MetricsAnalyticsResponse> = await res.json();

if (!body.success) {
  console.error(body.error?.code, body.error?.message);
  return;
}

const metrics = body.data!;

// Safe access with null guards
const avgVerification = metrics.kyc.avg_verification_hours;
const display = avgVerification !== null
  ? formatHours(avgVerification)
  : 'No data yet';

// User growth chart (already sorted oldest → newest)
const userChartData = metrics.growth.user_growth_monthly.map(m => ({
  x: m.label,                    // "Jan 26" / "Week 1" / "Mon" depending on granularity
  newUsers: m.new_users,         // registrations this period — use for bar chart
  cumulative: m.cumulative_users, // all-time running total — use for line chart
}));

// Trade volume chart
const tradeChartData = metrics.growth.trade_volume_monthly.map(m => ({
  x: m.label,
  periodVolume: Number(m.ngn_volume),            // this period only — use for bar chart
  cumulativeVolume: Number(m.cumulative_ngn_volume), // running total — use for line/area chart
  //   ^ never shows ₦0 for the current month even if no trades have happened yet
  trades: m.completed_trades,
}));
```

---

## Appendix: Admin Portal Page Map

Suggested page structure for the admin portal:

```
/admin
  /login              → 2-step auth (password → OTP)
  /dashboard          → GET /admin/dashboard  (snapshot + 7-day charts)
  /analytics
    /metrics          → GET /admin/analytics/metrics (full metrics dashboard)
    /impact           → GET /admin/analytics/impact  (investor summary)
  /users              → GET /admin/users (paginated table)
  /users/:id          → GET /admin/users/:id (detail + suspend/reinstate)
  /kyc                → GET /admin/kyc (queue + approve/reject)
  /deposits           → GET /admin/deposits (list + approve/reject/verify)
  /trades             → GET /admin/trades (read-only list)
  /disputes           → GET /admin/disputes (list + resolve)
  /transactions       → GET /admin/transactions (ledger view)
  /admins             → GET /admin/admins [SA] + invite/remove/upgrade
  /logs               → GET /admin/logs
  /profile            → GET /admin/profile + picture upload
```

## Appendix: User App Page Map

Suggested page structure for the user-facing app:

```
/auth
  /register           → POST /auth/register
  /login              → POST /auth/login → POST /auth/verify-otp
  /forgot-password    → POST /auth/forgot-password
  /reset-password     → POST /auth/reset-password
  /verify-email       → GET /auth/verify-email?token=

/dashboard            → GET /wallets (balance summary)

/marketplace          → GET /sabits (public listing browse)
/marketplace/:id      → GET /sabits/:id + POST /bids + POST /trades/initiate

/wallet
  /overview           → GET /wallets (all 4 wallets)
  /history            → GET /ledger (all transactions, filterable)
  /history/:walletId  → GET /ledger/:walletId

/deposit
  /ngn                → POST /deposits/ngn/initiate (Flutterwave link)
  /foreign            → POST /deposits/foreign (proof upload form)
  /history            → GET /deposits

/withdraw
  /request            → POST /withdrawals/request (requires beneficiary)
  /history            → GET /withdrawals

/beneficiaries        → GET + POST /beneficiaries
/beneficiaries/:id    → DELETE + PUT /beneficiaries/:id/set-default

/trades               → GET /trades (my trades)
/trades/:id           → GET /trades/:id + PUT /trades/:id/seller-confirm

/bids
  /mine               → GET /bids/mine
  /received           → GET /bids/received
  /:id                → PUT /bids/:id/accept or /reject or /withdraw

/disputes             → GET /disputes
/disputes/raise       → POST /disputes/raise
/disputes/:id         → GET /disputes/:id

/kyc                  → GET /kyc/status + POST /kyc/upload

/rates                → GET /rates (market overview)
/rates/:pair          → GET /rates/history/:pair

/conversions          → POST /conversions/quote + POST /conversions/execute

/notifications        → GET /notifications

/settings
  /username           → PUT /account/username
  /pin                → POST /account/transaction-pin/set
  /profile-picture    → POST /account/profile/picture
  /email              → POST /account/email-change/initiate + /confirm
  /delete             → POST /account/delete/initiate + /confirm

/profile/:id          → GET /ratings/user/:id (public reputation)
```
