# Sabo Finance — API Documentation

> **Base URL:** `https://api.sabofinance.com` (Production) | `http://localhost:3000` (Local)
> **API Docs (Swagger UI):** `GET /api/docs`
> **Version:** Current as of 2026-04-03

---

## Table of Contents

1. [Response Envelope](#response-envelope)
2. [Authentication](#authentication)
3. [Error Codes](#error-codes)
4. [Auth Endpoints](#auth-endpoints)
5. [Account Management](#account-management)
6. [Wallets](#wallets)
7. [Ledger](#ledger)
8. [Deposits](#deposits)
9. [Withdrawals](#withdrawals)
10. [Beneficiaries](#beneficiaries)
11. [KYC Verification](#kyc-verification)
12. [Exchange Rates](#exchange-rates)
13. [Conversions](#conversions)
14. [Sabits (P2P Listings)](#sabits-p2p-listings)
15. [Trades](#trades)
16. [Bids (Counter-Offers)](#bids-counter-offers)
17. [Disputes](#disputes)
18. [Ratings](#ratings)
19. [Notifications](#notifications)
20. [Admin — Auth & Setup](#admin--auth--setup)
21. [Admin — User Management](#admin--user-management)
22. [Admin — KYC Management](#admin--kyc-management)
23. [Admin — Deposit Management](#admin--deposit-management)
24. [Admin — Analytics & Reporting](#admin--analytics--reporting)
25. [Admin — Admin Management](#admin--admin-management)
26. [Webhooks](#webhooks)
27. [Health Check](#health-check)

---

## Response Envelope

All API responses follow a consistent JSON envelope structure.

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": {},
  "error": null
}
```

### Error
```json
{
  "success": false,
  "data": null,
  "meta": {},
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message explaining what went wrong"
  }
}
```

---

## Authentication

The API uses **JWT Bearer tokens** for authentication.

```
Authorization: Bearer <accessToken>
```

- **Access Token:** Valid for **30 minutes** (user) / **8 hours** (admin)
- **Refresh Token:** Valid for **30 days**
- **Sliding window:** Access tokens are auto-renewed by the server if within 10 minutes of expiry (new token in response headers)
- **OTP login:** Both user and admin logins require a second-factor OTP sent via email after password verification

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `INVALID_OTP` | 400 | OTP is incorrect or expired |
| `INVALID_TOKEN` | 400 | JWT or reset token is invalid/expired |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token invalid/expired |
| `ACCOUNT_SUSPENDED` | 401 | User account is suspended |
| `ACCOUNT_DELETED` | 401 | User account has been soft-deleted |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `KYC_NOT_VERIFIED` | 403 | KYC verification required for this action |
| `NOT_FOUND` | 404 | Resource does not exist |
| `INVALID_PIN` | 401 | Transaction PIN is incorrect |
| `PIN_EXPIRED` | 400 | 30-minute trade confirmation window expired |
| `SELF_TRADE_NOT_ALLOWED` | 400 | Cannot trade against your own listing |
| `INSUFFICIENT_BALANCE` | 400 | Wallet balance too low |
| `INSUFFICIENT_SABIT_AMOUNT` | 400 | Trade amount exceeds listing available amount |
| `VALIDATION_ERROR` | 400 | Zod schema validation failure |

---

## Auth Endpoints

### `POST /auth/register`
Registers a new user. Automatically creates 4 wallets (NGN, GBP, USD, CAD) and sends a verification email and welcome email.

**Auth required:** No

**Request Body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348000000000",
  "password": "Password123!"
}
```

**Validation:**
- `name`: min 2 characters
- `email`: valid email format
- `phone`: 7–32 characters
- `password`: min 8 characters

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Jane Doe",
      "username": "jane_doe_1a2b",
      "email": "jane@example.com",
      "phone": "+2348000000000",
      "email_verified": false,
      "phone_verified": false,
      "kyc_status": "unverified",
      "role": "user",
      "profile_picture_url": null,
      "is_suspended": false,
      "created_at": "2026-04-03T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ..."
    }
  }
}
```

---

### `GET /auth/verify-email`
Verifies the user's email address using the signed token from the verification link.

**Auth required:** No

**Query Params:**
- `token` (required): JWT token from the email verification link

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Email verified successfully" }
}
```

---

### `POST /auth/login`
Step 1 of login. Validates credentials and sends a 6-digit OTP to the user's email. OTP is valid for **10 minutes**.

**Auth required:** No

**Request Body:**
```json
{
  "email": "jane@example.com",
  "password": "Password123!"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "An OTP has been sent to your email." }
}
```

---

### `POST /auth/verify-otp`
Step 2 of login. Verifies the OTP and returns JWT tokens.

**Auth required:** No

**Request Body:**
```json
{
  "email": "jane@example.com",
  "otp": "123456"
}
```

**Validation:**
- `otp`: exactly 6 characters

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ..."
    }
  }
}
```

---

### `POST /auth/refresh-token`
Exchanges a valid refresh token for new access and refresh tokens.

**Auth required:** No

**Request Body:**
```json
{
  "refreshToken": "eyJ..."
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ..."
    }
  }
}
```

---

### `POST /auth/forgot-password`
Sends a password reset link to the user's email. Link is valid for **10 minutes**. Always returns 200 (to prevent email enumeration).

**Auth required:** No

**Request Body:**
```json
{
  "email": "jane@example.com"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "message": "If a user with that email exists, a password reset link has been sent."
  }
}
```

---

### `POST /auth/reset-password`
Resets the user's password using the token from the reset email.

**Auth required:** No

**Request Body:**
```json
{
  "token": "hex-reset-token",
  "password": "NewPassword123!"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Password has been reset successfully." }
}
```

---

### `POST /auth/logout`
Logout. The server has no token state — the client discards the tokens. A confirmation response is returned.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": { "loggedOut": true }
}
```

---

### `GET /auth/me`
Returns the full profile of the currently authenticated user.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Jane Doe",
      "username": "jane_doe_1a2b",
      "email": "jane@example.com",
      "phone": "+2348000000000",
      "email_verified": true,
      "phone_verified": false,
      "kyc_status": "verified",
      "transaction_pin_set": true,
      "role": "user",
      "profile_picture_url": "https://res.cloudinary.com/...",
      "is_suspended": false,
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

## Account Management

### `PUT /account/username`
Updates the authenticated user's username.

**Auth required:** Yes

**Request Body:**
```json
{
  "username": "jane_doe_new"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Username updated successfully." }
}
```

---

### `POST /account/transaction-pin/set`
Sets or changes the user's 6-digit transaction PIN. Required before initiating or confirming trades.

**Auth required:** Yes

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Validation:** `pin` must be exactly 6 digits.

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Transaction PIN set successfully." }
}
```

---

### `POST /account/transaction-pin/verify`
Verifies the user's current transaction PIN without performing a trade action.

**Auth required:** Yes

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "valid": true }
}
```

---

### `POST /account/profile/picture`
Uploads a new profile picture via Cloudinary.

**Auth required:** Yes

**Request:** `multipart/form-data`
- `file`: image file (max 10MB)

**Response `200`:**
```json
{
  "success": true,
  "data": { "profile_picture_url": "https://res.cloudinary.com/..." }
}
```

---

### `POST /account/delete/initiate`
Initiates account deletion. Sends an OTP to the user's email to confirm the action.

**Auth required:** Yes

**Rate Limit:** 10 requests per 15 minutes

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "A confirmation code has been sent to your email." }
}
```

---

### `POST /account/delete/confirm`
Confirms account deletion using the OTP. Performs a soft delete (`deleted_at` timestamp set).

**Auth required:** Yes

**Request Body:**
```json
{
  "otp": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Your account has been deleted." }
}
```

---

### `POST /account/email-change/initiate`
Initiates an email address change. Sends an OTP to the **new** email and an alert to the old email.

**Auth required:** Yes

**Rate Limit:** 10 requests per 15 minutes

**Request Body:**
```json
{
  "new_email": "new@example.com"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "A verification code has been sent to your new email address." }
}
```

---

### `POST /account/email-change/confirm`
Confirms the email change using the OTP sent to the new email.

**Auth required:** Yes

**Request Body:**
```json
{
  "otp": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Email address updated successfully." }
}
```

---

## Wallets

### `GET /wallets`
Returns all wallets for the authenticated user (NGN, GBP, USD, CAD).

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "wallets": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "currency": "NGN",
        "balance": "25000.00",
        "locked_balance": "5000.00",
        "escrow_balance": "0.00",
        "updated_at": "2026-04-03T10:00:00.000Z"
      }
    ]
  }
}
```

---

### `GET /wallets/:currency`
Returns a single wallet by currency code.

**Auth required:** Yes

**Path Params:**
- `currency`: `NGN` | `GBP` | `USD` | `CAD`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "wallet": {
      "id": "uuid",
      "currency": "GBP",
      "balance": "500.00",
      "locked_balance": "0.00",
      "escrow_balance": "100.00",
      "updated_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

## Ledger

### `GET /ledger`
Lists all ledger (transaction history) entries for the authenticated user across all wallets.

**Auth required:** Yes

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO date-time | Filter entries from this date |
| `to` | ISO date-time | Filter entries to this date |
| `type` | enum | Ledger entry type (see below) |
| `currency` | enum | `NGN` \| `GBP` \| `USD` \| `CAD` |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |

**Ledger Types:** `deposit`, `withdrawal`, `trade_debit`, `trade_credit`, `escrow_hold`, `escrow_release`, `reversal`, `adjustment`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "uuid",
        "reference": "TXN-2026-0001",
        "type": "deposit",
        "currency": "NGN",
        "amount": "5000.00",
        "balance_before": "20000.00",
        "balance_after": "25000.00",
        "status": "completed",
        "created_at": "2026-04-03T10:00:00.000Z"
      }
    ]
  }
}
```

---

### `GET /ledger/:walletId`
Lists ledger entries for a specific wallet. The wallet must belong to the authenticated user.

**Auth required:** Yes

**Path Params:**
- `walletId`: UUID of the wallet

**Query Params:** Same as `GET /ledger`

---

## Deposits

### `POST /deposits/ngn/initiate`
Initiates an NGN deposit via Flutterwave. Returns a deposit reference used to track the payment via webhook.

**Auth required:** Yes

**Request Body:**
```json
{
  "amount": "5000.00"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "deposit": {
      "id": "uuid",
      "reference": "DEP-2026-0001",
      "amount": "5000.00",
      "currency": "NGN",
      "status": "initiated",
      "provider": "flutterwave",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `POST /deposits/foreign`
Submits a manual foreign currency deposit (GBP, USD, or CAD) with proof of payment. The wallet is credited **only after admin approval**.

**Auth required:** Yes

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `currency` | string | `GBP` \| `USD` \| `CAD` |
| `amount` | string | Amount to deposit (e.g., `"100.00"`) |
| `proof` | file | Screenshot or bank transfer proof (max 10MB) |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "deposit": {
      "id": "uuid",
      "reference": "DEP-2026-0002",
      "currency": "GBP",
      "amount": "100.00",
      "status": "pending_review",
      "proof_url": "https://res.cloudinary.com/...",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `GET /deposits`
Lists all deposits for the authenticated user.

**Auth required:** Yes

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `status`: `initiated` | `pending_review` | `completed` | `failed` | `expired` | `rejected`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "deposits": [ { ... } ]
  }
}
```

---

### `GET /deposits/:id`
Gets a single deposit by ID. Must be owned by the authenticated user.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "deposit": {
      "id": "uuid",
      "reference": "DEP-2026-0001",
      "currency": "NGN",
      "amount": "5000.00",
      "status": "completed",
      "provider": "flutterwave",
      "provider_reference": "FLW-xxx",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

## Withdrawals

### `POST /withdrawals/request`
Requests a withdrawal to a saved beneficiary. Deducts from the wallet immediately and creates an admin-pending withdrawal record.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "beneficiary_id": "uuid",
  "amount": "1000.00"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "withdrawal": {
      "id": "uuid",
      "reference": "WDR-2026-0001",
      "amount": "1000.00",
      "currency": "NGN",
      "status": "requested",
      "beneficiary_id": "uuid",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `GET /withdrawals`
Lists all withdrawals for the authenticated user.

**Auth required:** Yes

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)

---

### `GET /withdrawals/:id`
Gets a single withdrawal by ID. Must be owned by the authenticated user.

**Auth required:** Yes

---

## Beneficiaries

### `POST /beneficiaries`
Adds a new beneficiary (bank account) for withdrawals.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "currency": "GBP",
  "bank_name": "Barclays",
  "account_name": "Jane Doe",
  "account_number": "12345678",
  "sort_code": "20-00-00",
  "iban": "GB29NWBK60161331926819"
}
```

**Field Rules:**
- For **NGN**: `bank_name`, `account_name`, `account_number` required
- For **GBP/USD/CAD**: `bank_name`, `account_name`, and optionally `iban` / `sort_code` / `account_number`

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "beneficiary": {
      "id": "uuid",
      "currency": "GBP",
      "bank_name": "Barclays",
      "account_name": "Jane Doe",
      "is_default": false
    }
  }
}
```

---

### `GET /beneficiaries`
Lists all beneficiaries for the authenticated user.

**Auth required:** Yes

---

### `DELETE /beneficiaries/:id`
Deletes a beneficiary. Must be owned by the authenticated user.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Beneficiary removed." }
}
```

---

## KYC Verification

### `POST /kyc/upload`
Submits KYC documents for review. Sets user's `kyc_status` to `pending`.

**Auth required:** Yes

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `document_type` | string | e.g., `passport`, `national_id`, `drivers_license` |
| `document` | file | Document image (max 10MB) |
| `selfie` | file | Selfie/liveness photo (max 10MB) |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "kyc": {
      "id": "uuid",
      "status": "pending",
      "document_type": "passport",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `GET /kyc/status`
Returns the user's current KYC status and latest KYC submission record.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "kyc_status": "pending",
    "kyc": {
      "id": "uuid",
      "status": "pending",
      "document_type": "passport",
      "document_url": "https://res.cloudinary.com/...",
      "selfie_url": "https://res.cloudinary.com/...",
      "rejection_reason": null,
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

**KYC Statuses:** `unverified` | `pending` | `verified` | `rejected`

---

## Exchange Rates

### `GET /rates`
Returns the latest FX rates for all supported currency pairs. Rates are synced automatically via a background job.

**Auth required:** No

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "rates": [
      { "pair": "GBP/NGN", "rate": "2050.00", "source": "auto", "created_at": "..." },
      { "pair": "USD/NGN", "rate": "1600.00", "source": "auto", "created_at": "..." },
      { "pair": "CAD/NGN", "rate": "1180.00", "source": "auto", "created_at": "..." }
    ]
  }
}
```

---

## Conversions

### `POST /conversions/quote`
Generates a conversion quote between two currencies. Does **not** execute the conversion.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "quote": {
      "from": "USD",
      "to": "NGN",
      "amount": "100.00",
      "resultAmount": "160000.00",
      "rate": "1600.00",
      "expiresAt": "2026-04-03T10:05:00.000Z"
    }
  }
}
```

---

### `POST /conversions/execute`
Executes a currency conversion. Debits the source wallet and credits the target wallet in a single atomic transaction.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "conversion": {
      "reference": "TXN-2026-0010",
      "from": "USD",
      "to": "NGN",
      "amount": "100.00",
      "resultAmount": "160000.00",
      "rate": "1600.00"
    }
  }
}
```

---

## Sabits (P2P Listings)

Sabits are P2P marketplace listings for trading foreign currency against NGN.

### `POST /sabits`
Creates a new Sabit listing. Locks the corresponding wallet funds immediately.

- A **SELL** sabit locks the seller's foreign currency.
- A **BUY** sabit locks the buyer's NGN equivalent.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "type": "SELL",
  "currency": "GBP",
  "amount": "200.00",
  "rate_ngn": "2050.00",
  "payment_methods": ["bank_transfer", "cash"]
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "sabit": {
      "id": "uuid",
      "type": "SELL",
      "currency": "GBP",
      "amount": "200.00",
      "available_amount": "200.00",
      "rate_ngn": "2050.00",
      "payment_methods": ["bank_transfer", "cash"],
      "status": "active",
      "user_id": "uuid",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `GET /sabits`
Lists all active Sabits on the marketplace. Public endpoint.

**Auth required:** No

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `type` | string | `BUY` \| `SELL` |
| `currency` | string | `GBP` \| `USD` \| `CAD` |
| `page` | number | Default: 1 |
| `limit` | number | Default: 20 |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "sabits": [ { ... } ]
  }
}
```

---

### `GET /sabits/:id`
Gets a single Sabit by ID. Public endpoint.

**Auth required:** No

---

### `POST /sabits/:id/cancel`
Cancels an active Sabit and releases the locked wallet funds back to the user.

**Auth required:** Yes (KYC Verified, must be owner)

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Sabit cancelled and funds released." }
}
```

---

## Trades

Trades are executed transactions between a Sabit owner (seller) and a counterpart (buyer).

### Trade Lifecycle

```
initiated → escrowed → completed
                   ↘ disputed
          ↘ cancelled (PIN expired)
```

**PIN Confirmation Window:** When a trade is initiated, both parties have **30 minutes** to confirm using their transaction PIN. If the seller does not confirm via `PUT /trades/:id/seller-confirm` within this window, the trade is automatically cancelled and locked funds are released.

---

### `POST /trades/initiate`
Initiates a trade against an active Sabit. Requires buyer's transaction PIN. Locks funds and notifies the seller.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "sabit_id": "uuid",
  "amount": "50.00",
  "pin": "123456"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "trade": {
      "id": "uuid",
      "reference": "TXN-2026-0001",
      "sabit_id": "uuid",
      "buyer_id": "uuid",
      "seller_id": "uuid",
      "currency": "GBP",
      "amount": "50.00",
      "rate_ngn": "2050.00",
      "total_ngn": "102500.00",
      "status": "initiated",
      "buyer_pin_verified": true,
      "pin_expires_at": "2026-04-03T10:30:00.000Z",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `PUT /trades/:id/seller-confirm`
Seller confirms the trade with their PIN. Must be done within the 30-minute window. On success, immediately settles the trade (transfers NGN to seller, foreign currency to buyer) and marks as `completed`.

**Auth required:** Yes (KYC Verified, must be the seller)

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Trade confirmed and settled successfully" }
}
```

---

### `POST /trades/:id/confirm`
Legacy seller confirmation. Moves trade status to `escrowed`. Use `PUT /trades/:id/seller-confirm` for the full settlement flow.

**Auth required:** Yes (must be the seller)

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Trade confirmed and funds are in escrow" }
}
```

---

### `POST /trades/:id/complete`
Completes an escrowed trade (legacy flow). Settles NGN and foreign currency to the respective parties.

**Auth required:** Yes (must be the seller)

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Trade completed successfully" }
}
```

---

### `GET /trades`
Lists all trades for the authenticated user (as buyer or seller).

**Auth required:** Yes (KYC Verified)

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Default: 1 |
| `limit` | number | Default: 20 |
| `status` | string | `initiated` \| `escrowed` \| `confirmed` \| `completed` \| `cancelled` \| `disputed` |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "id": "uuid",
        "reference": "TXN-2026-0001",
        "status": "completed",
        "currency": "GBP",
        "amount": "50.00",
        "rate_ngn": "2050.00",
        "total_ngn": "102500.00",
        "buyer_name": "Jane Doe",
        "seller_name": "John Smith",
        "created_at": "2026-04-03T10:00:00.000Z",
        "completed_at": "2026-04-03T10:15:00.000Z"
      }
    ]
  }
}
```

---

### `GET /trades/:id`
Gets a single trade by ID. Only accessible to the buyer or seller of the trade.

**Auth required:** Yes (KYC Verified)

---

## Bids (Counter-Offers)

Bids allow buyers to propose a different rate on an existing SELL Sabit. The bid locks the buyer's funds and expires after **24 hours** if not accepted.

### `POST /bids`
Places a bid (counter-offer) on a SELL Sabit.

**Auth required:** Yes (KYC Verified)

**Request Body:**
```json
{
  "sabit_id": "uuid",
  "amount": "100.00",
  "proposed_rate_ngn": "1480.00",
  "pin": "123456"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "bid": {
      "id": "uuid",
      "sabit_id": "uuid",
      "buyer_id": "uuid",
      "seller_id": "uuid",
      "amount": "100.00",
      "proposed_rate_ngn": "1480.00",
      "original_rate_ngn": "1500.00",
      "total_ngn_at_bid_rate": "148000.00",
      "status": "pending",
      "expires_at": "2026-04-04T10:00:00.000Z"
    }
  }
}
```

---

### `GET /bids/mine`
Lists all bids placed by the authenticated user.

**Auth required:** Yes

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)

---

### `GET /bids/received`
Lists all bids received by the authenticated user on their Sabits.

**Auth required:** Yes

---

### `PUT /bids/:id/accept`
Seller accepts a bid. Triggers trade creation and fund settlement.

**Auth required:** Yes (must be the Sabit owner)

**Request Body:**
```json
{
  "pin": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "message": "Bid accepted. Trade created.",
    "trade": { ... }
  }
}
```

---

### `PUT /bids/:id/reject`
Seller rejects a bid. Releases the buyer's locked funds.

**Auth required:** Yes (must be the Sabit owner)

**Request Body:**
```json
{
  "pin": "123456",
  "reason": "Rate too low"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Bid rejected." }
}
```

---

### `PUT /bids/:id/withdraw`
Buyer withdraws their own pending bid. Releases locked funds.

**Auth required:** Yes (must be the bid placer)

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Bid withdrawn." }
}
```

---

## Disputes

Disputes can be raised on trades that are in `escrowed` or `confirmed` status.

### `POST /disputes/raise`
Raises a dispute for a trade.

**Auth required:** Yes (KYC Verified, must be buyer or seller of the trade)

**Request Body:**
```json
{
  "trade_id": "uuid",
  "reason": "Seller has not released funds after I sent payment (min 20 chars)"
}
```

**Validation:** `reason` must be at least 20 characters.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "dispute": {
      "id": "uuid",
      "trade_id": "uuid",
      "raised_by_id": "uuid",
      "reason": "...",
      "status": "open",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

### `GET /disputes`
Lists all disputes where the authenticated user is a party (buyer or seller).

**Auth required:** Yes

---

### `GET /disputes/:id`
Gets a single dispute by ID. Must be a party to the dispute.

**Auth required:** Yes

---

## Ratings

Post-trade ratings for sellers. Can only be submitted once per trade.

### `POST /ratings`
Submits a rating for the seller after a completed trade.

**Auth required:** Yes

**Request Body:**
```json
{
  "trade_id": "uuid",
  "score": 5,
  "comment": "Quick and trustworthy seller!"
}
```

**Validation:**
- `score`: integer 1–5
- `comment`: optional string

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "rating": {
      "id": "uuid",
      "trade_id": "uuid",
      "rater_id": "uuid",
      "rated_user_id": "uuid",
      "score": 5,
      "comment": "Quick and trustworthy seller!",
      "created_at": "2026-04-03T10:00:00.000Z"
    }
  }
}
```

---

## Notifications

### `GET /notifications`
Lists notifications for the authenticated user. Includes global (broadcast) notifications. Admins see all notifications.

**Auth required:** Yes

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "title": "Trade Completed",
        "message": "Your trade TXN-2026-0001 has been settled.",
        "type": "success",
        "status": "unread",
        "related_id": "uuid",
        "created_at": "2026-04-03T10:00:00.000Z"
      }
    ]
  }
}
```

**Notification Types:** `info` | `success` | `warning` | `error`

---

### `PATCH /notifications/:id/read`
Marks a specific notification as read.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Notification marked as read." }
}
```

---

### `POST /notifications/mark-all-read`
Marks all notifications for the authenticated user as read.

**Auth required:** Yes

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "All notifications marked as read." }
}
```

---

## Admin — Auth & Setup

Admin tokens have an **8-hour** access token lifetime (vs. 30 min for users).

### `POST /admin/auth/login`
Step 1 of admin login. Validates credentials (must be `admin` or `super_admin` role) and sends OTP.

**Auth required:** No

**Request Body:**
```json
{
  "email": "admin@sabofinance.com",
  "password": "AdminPass123!"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "An OTP has been sent to your email." }
}
```

---

### `POST /admin/auth/verify-otp`
Step 2 of admin login. Verifies OTP and returns admin-scoped JWT tokens.

**Auth required:** No

**Request Body:**
```json
{
  "email": "admin@sabofinance.com",
  "otp": "123456"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ..."
    },
    "user": {
      "id": "uuid",
      "name": "Admin User",
      "email": "admin@sabofinance.com",
      "role": "admin"
    }
  }
}
```

---

### `GET /admin/invites/accept`
Validates an admin invite token from an invite email link. Returns invite metadata.

**Auth required:** No

**Query Params:**
- `token` (required): Invite token from email

---

### `POST /admin/invites/setup`
Completes admin onboarding — sets the admin's name and password using the invite token.

**Auth required:** No

**Request Body:**
```json
{
  "token": "invite-token",
  "name": "New Admin",
  "password": "SecurePass123!"
}
```

---

## Admin — User Management

All routes below require: **Auth (Admin or Super Admin)**

### `GET /admin/users`
Lists all platform users with pagination.

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `search` (optional): search by name/email

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "users": [ { "id": "uuid", "name": "...", "email": "...", "kyc_status": "...", "role": "user", ... } ],
    "total": 150
  }
}
```

---

### `GET /admin/users/:id`
Gets a specific user's full profile including all their wallets.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "wallets": [ { "currency": "NGN", "balance": "...", ... } ]
  }
}
```

---

### `POST /admin/users/:id/suspend`
Suspends a user account. The user will be blocked from logging in.

**Request Body (optional):**
```json
{
  "reason": "Suspicious activity detected"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "User suspended." }
}
```

---

### `POST /admin/users/:id/reinstate`
Reinstates a previously suspended user account.

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "User reinstated." }
}
```

---

## Admin — KYC Management

### `GET /admin/kyc`
Lists all KYC submissions across the platform with pagination.

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `status`: `pending` | `verified` | `rejected`

---

### `POST /admin/kyc/:id/approve`
Approves a KYC submission. Updates the user's `kyc_status` to `verified`. Sends approval email.

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "KYC approved." }
}
```

---

### `POST /admin/kyc/:id/reject`
Rejects a KYC submission with a reason. Updates user `kyc_status` to `rejected`. Sends rejection email.

**Request Body:**
```json
{
  "reason": "Document is blurry and unreadable."
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "KYC rejected." }
}
```

---

## Admin — Deposit Management

### `GET /admin/deposits`
Lists all deposits across the platform.

**Query Params:**
- `page`, `limit`
- `status`: `initiated` | `pending_review` | `completed` | `failed` | `expired` | `rejected`
- `currency`: `NGN` | `GBP` | `USD` | `CAD`

---

### `POST /admin/deposits/:id/approve`
Approves a pending manual deposit. Credits the user's wallet atomically.

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Deposit approved and wallet credited." }
}
```

---

### `POST /admin/deposits/:id/reject`
Rejects a pending deposit with a reason. Sends rejection email to the user.

**Request Body:**
```json
{
  "reason": "Proof of payment does not match the claimed amount."
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Deposit rejected." }
}
```

---

### `POST /admin/deposits/:id/verify-flutterwave`
Manually triggers a Flutterwave deposit verification (for stuck/missed webhooks).

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Deposit verified via Flutterwave." }
}
```

---

## Admin — Analytics & Reporting

### `GET /admin/dashboard`
Returns platform-wide summary statistics for the admin dashboard.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": "150",
      "active": "140",
      "suspended": "10"
    },
    "kyc": {
      "total": "80",
      "pending": "15",
      "verified": "60",
      "rejected": "5"
    },
    "pendingDeposits": [ { ... } ],
    "recentKyc": [ { ... } ],
    "charts": {
      "kycSubmissions": [
        { "label": "Mon", "value": "5" },
        { "label": "Tue", "value": "8" }
      ],
      "deposits": [
        { "label": "Mon", "value": "2" }
      ]
    }
  }
}
```

---

### `GET /admin/analytics/impact`
Returns platform impact metrics (trade volume, conversion totals, user growth, etc.).

**Auth required:** Yes (Admin)

---

### `GET /admin/trades`
Lists all trades across the platform.

**Query Params:**
- `page` (default: 1)
- `limit` (default: 20)
- `status`: any trade status

---

### `GET /admin/disputes`
Lists all disputes across the platform.

**Query Params:**
- `page`, `limit`
- `status`: `open` | `resolved` | `closed`

---

### `GET /admin/transactions`
Lists all ledger transactions across the platform.

**Query Params:**
- `page`, `limit`

---

### `GET /admin/logs`
Lists the admin action audit trail (`admin_logs` table).

**Query Params:**
- `page`, `limit`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "uuid",
        "admin_id": "uuid",
        "action": "approve_kyc",
        "target_type": "kyc",
        "target_id": "uuid",
        "details": { ... },
        "created_at": "2026-04-03T10:00:00.000Z"
      }
    ]
  }
}
```

---

## Admin — Admin Management

These routes require **Super Admin** role.

### `GET /admin/admins`
Lists all admin and super_admin accounts.

---

### `POST /admin/invites`
Invites a new admin by email. Sends an invite link with a signed token.

**Rate Limit:** 20 requests per hour

**Request Body:**
```json
{
  "email": "newadmin@sabofinance.com",
  "role": "admin"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": { "message": "Invite sent to newadmin@sabofinance.com" }
}
```

---

### `POST /admin/admins/:id/remove`
Removes an admin's admin role (downgrades to user role).

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Admin removed." }
}
```

---

### `POST /admin/admins/:id/upgrade`
Upgrades an admin to super_admin role.

**Response `200`:**
```json
{
  "success": true,
  "data": { "message": "Admin upgraded to super_admin." }
}
```

---

### `GET /admin/profile`
Returns the authenticated admin's own profile.

---

### `POST /admin/profile/picture`
Uploads a profile picture for the admin.

**Request:** `multipart/form-data`
- `file`: image (max 10MB)

---

## Webhooks

### `POST /webhooks/flutterwave`
Receives and processes Flutterwave payment webhooks. Only processes `charge.completed` events. Validates the `verif-hash` header against `FLUTTERWAVE_WEBHOOK_HASH`. Idempotent — duplicate events are safely ignored.

**Auth required:** No (header-based HMAC validation)

**Headers:**
```
verif-hash: <FLUTTERWAVE_WEBHOOK_HASH>
```

**Request Body (from Flutterwave):**
```json
{
  "event": "charge.completed",
  "data": {
    "tx_ref": "DEP-2026-0001",
    "status": "successful",
    "amount": 5000,
    "currency": "NGN"
  }
}
```

**Response `200`:**
```json
{ "received": true }
```

---

## Health Check

### `GET /health`
Returns the current health status of the API server.

**Auth required:** No

**Response `200`:**
```json
{
  "success": true,
  "data": { "status": "ok" },
  "meta": {},
  "error": null
}
```

---

## Reference Formats

| Scope | Format | Example |
|-------|--------|---------|
| Deposit | `DEP-{YEAR}-{SEQ}` | `DEP-2026-0001` |
| Trade | `TXN-{YEAR}-{SEQ}` | `TXN-2026-0042` |
| Withdrawal | `WDR-{YEAR}-{SEQ}` | `WDR-2026-0007` |
| Bid | `BID-{YEAR}-{SEQ}` | `BID-2026-0003` |

Sequences are generated atomically via the `reference_sequences` table to prevent duplicates under concurrent load.

---

## Supported Currencies

| Code | Name | Notes |
|------|------|-------|
| `NGN` | Nigerian Naira | Deposits via Flutterwave; base currency for all trades |
| `GBP` | British Pound | Manual deposit with proof of payment |
| `USD` | US Dollar | Manual deposit with proof of payment |
| `CAD` | Canadian Dollar | Manual deposit with proof of payment |
