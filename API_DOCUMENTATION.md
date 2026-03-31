## Sabo Finance API Documentation

All responses follow the standard envelope:

### Success
```json
{
  "success": true,
  "data": {},
  "meta": {},
  "error": null
}
```

### Error
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

Auth uses **Bearer JWT**:

`Authorization: Bearer <accessToken>`

---

## Auth

### Endpoint
`POST /auth/register`

### Description
Registers a new user and automatically creates wallets for **NGN, GBP, USD, CAD**.

### Request Body
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348000000000",
  "password": "Password123!"
}
```

### Response Example
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+2348000000000",
      "email_verified": false,
      "phone_verified": false,
      "kyc_status": "unverified",
      "role": "user",
      "is_suspended": false,
      "created_at": "..."
    },
    "tokens": {
      "accessToken": "jwt",
      "refreshToken": "jwt"
    }
  }
}
```

### Endpoint
`POST /auth/login`

### Description
Authenticates a user and sends an OTP to their email.

### Request Body
```json
{
  "email": "jane@example.com",
  "password": "Password123!"
}
```

### Response Example
```json
{
  "success": true,
  "data": {
    "message": "An OTP has been sent to your email."
  }
}
```

### Endpoint
`POST /auth/verify-otp`

### Description
Verifies the OTP sent during login and returns access/refresh tokens.

### Request Body
```json
{
  "email": "jane@example.com",
  "otp": "123456"
}
```

### Response Example
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "jwt",
      "refreshToken": "jwt"
    }
  }
}
```

### Endpoint
`POST /auth/refresh-token`

### Description
Refreshes the access token using a valid refresh token.

### Request Body
```json
{
  "refreshToken": "jwt"
}
```

### Response Example
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "jwt",
      "refreshToken": "jwt"
    }
  }
}
```

### Endpoint
`POST /auth/forgot-password`

### Description
Sends a password reset link to the user's email.

### Request Body
```json
{
  "email": "jane@example.com"
}
```

### Endpoint
`POST /auth/reset-password`

### Description
Resets the user's password using the token from the reset link.

### Request Body
```json
{
  "token": "reset-token",
  "password": "NewPassword123!"
}
```

### Endpoint
`POST /auth/logout`

### Description
Logout endpoint (client discards tokens).

### Auth Required
Yes

---

### Endpoint
`GET /admin/dashboard`

### Description
Retrieves aggregated statistics for the admin dashboard, including user counts, KYC statuses, and chart data for the last 7 days.

### Auth Required
Yes (Admin)

### Response Example
```json
{
  "success": true,
  "data": {
    "users": { "total": "100", "active": "95", "suspended": "5" },
    "kyc": { "total": "50", "pending": "10", "verified": "35", "rejected": "5" },
    "pendingDeposits": [],
    "recentKyc": [],
    "charts": {
      "kycSubmissions": [{ "label": "Mon", "value": "5" }, "..."],
      "deposits": [{ "label": "Mon", "value": "2" }, "..."]
    }
  }
}
```

## Notifications

### Endpoint
`GET /notifications`

### Description
Lists notifications for the authenticated user (including global alerts). Admins see all notifications.

### Auth Required
Yes

### Query Params
- `page` (optional, default 1)
- `limit` (optional, default 20)

### Endpoint
`PATCH /notifications/:id/read`

### Description
Marks a specific notification as read.

### Auth Required
Yes

### Endpoint
`POST /notifications/mark-all-read`

### Description
Marks all notifications for the authenticated user as read.

### Auth Required
Yes

---

## Wallets

### Endpoint
`GET /wallets`

### Description
Returns all wallets for the authenticated user.

### Auth Required
Yes

### Endpoint
`GET /wallets/:currency`

### Description
Returns a wallet by currency (`NGN|GBP|USD|CAD`).

### Auth Required
Yes

---

## Ledger

### Endpoint
`GET /ledger`

### Description
Lists ledger entries for the authenticated user.

### Query Params
- `from` (date-time)
- `to` (date-time)
- `type` (ledger type enum)
- `currency` (NGN|GBP|USD|CAD)

### Auth Required
Yes

### Endpoint
`GET /ledger/:walletId`

### Description
Lists ledger entries for a specific wallet (must belong to the user).

### Auth Required
Yes

---

## Deposits

### Endpoint
`POST /deposits/ngn/initiate`

### Description
Creates a Flutterwave NGN deposit record and returns the deposit reference.

### Auth Required
Yes

### Request Body
```json
{
  "amount": "5000.00"
}
```

### Endpoint
`POST /deposits/foreign`

### Description
Submit manual foreign deposit (GBP/USD/CAD) with proof upload. Wallet is credited **only on admin approval**.

### Auth Required
Yes

### Request (multipart/form-data)
- `currency`: `GBP|USD|CAD`
- `amount`: string
- `proof`: file

### Endpoint
`GET /deposits`

### Description
List deposits for the authenticated user.

### Auth Required
Yes

### Endpoint
`GET /deposits/:id`

### Description
Get deposit by id (owned by the authenticated user).

### Auth Required
Yes

---

## Withdrawals

### Endpoint
`POST /withdrawals/request`

### Description
Requests a new withdrawal to a specified beneficiary.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "beneficiary_id": "uuid",
  "amount": "1000.00"
}
```

### Endpoint
`GET /withdrawals`

### Description
List withdrawals for the authenticated user.

### Auth Required
Yes

### Endpoint
`GET /withdrawals/:id`

### Description
Get a specific withdrawal by ID.

### Auth Required
Yes

---

## Beneficiaries

### Endpoint
`POST /beneficiaries`

### Description
Adds a new beneficiary for withdrawals.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "currency": "GBP|USD|CAD|NGN",
  "bank_name": "First Bank",
  "account_name": "John Doe",
  "account_number": "1234567890",
  "sort_code": "01-02-03",
  "iban": "GB29NWBK60161331926819"
}
```

### Endpoint
`GET /beneficiaries`

### Description
Lists all beneficiaries for the authenticated user.

### Auth Required
Yes

### Endpoint
`DELETE /beneficiaries/:id`

### Description
Deletes a beneficiary.

### Auth Required
Yes

---

## Conversions

### Endpoint
`POST /conversions/quote`

### Description
Gets a conversion quote between two currencies.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

### Response Example
```json
{
  "success": true,
  "data": {
    "quote": {
      "from": "USD",
      "to": "NGN",
      "amount": "100.00",
      "resultAmount": "150000.00",
      "rate": "1500.00",
      "expiresAt": "..."
    }
  }
}
```

### Endpoint
`POST /conversions/execute`

### Description
Executes a currency conversion.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

---

## Sabits (P2P Listings)

### Endpoint
`POST /sabits`

### Description
Creates a new Sabit (P2P listing) to buy or sell foreign currency.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "type": "BUY|SELL",
  "currency": "GBP|USD|CAD",
  "amount": "100.00",
  "rate_ngn": "1500.00"
}
```

### Endpoint
`GET /sabits`

### Description
Lists all active Sabits. Can be filtered by `type` and `currency`.

### Query Params
- `type` (BUY|SELL)
- `currency` (GBP|USD|CAD)

### Endpoint
`GET /sabits/:id`

### Description
Gets a specific Sabit by ID.

### Endpoint
`POST /sabits/:id/cancel`

### Description
Cancels an active Sabit and releases locked funds.

### Auth Required
Yes

---

## Trades

### Endpoint
`POST /trades/initiate`

### Description
Initiates a trade against an active Sabit.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "sabit_id": "uuid",
  "amount": "50.00"
}
```

### Endpoint
`POST /trades/:id/confirm`

### Description
Seller confirms the trade, moving funds to escrow.

### Auth Required
Yes

### Endpoint
`POST /trades/:id/complete`

### Description
Seller completes the trade after receiving payment, settling the trade and releasing funds from escrow to the buyer.

### Auth Required
Yes

---

## Disputes

### Endpoint
`POST /disputes/raise`

### Description
Raises a dispute for an escrowed or confirmed trade.

### Auth Required
Yes (Verified User)

### Request Body
```json
{
  "trade_id": "uuid",
  "reason": "Detailed reason for the dispute (min 20 chars)"
}
```

### Endpoint
`GET /disputes`

### Description
Lists all disputes where the user is a party (buyer or seller).

### Auth Required
Yes

### Endpoint
`GET /disputes/:id`

### Description
Gets a specific dispute by ID.

### Auth Required
Yes

---

## KYC

### Endpoint
`POST /kyc/upload`

### Description
Uploads KYC document and selfie. Sets user KYC status to `pending`.

### Auth Required
Yes

### Request (multipart/form-data)
- `document_type`: string
- `document`: file
- `selfie`: file

### Endpoint
`GET /kyc/status`

### Description
Returns the user's current KYC status and the latest KYC record.

### Auth Required
Yes

---

## Exchange Rates

### Endpoint
`GET /rates`

### Description
Returns the latest exchange rates for all currency pairs.

---

## Admin

### Endpoint
`POST /admin/auth/login`

### Description
Admin Step 1: Verify password and send an OTP to the admin's email.

### Request Body
```json
{
  "email": "admin@example.com",
  "password": "AdminPassword123!"
}
```

### Endpoint
`POST /admin/auth/verify-otp`

### Description
Admin Step 2: Verify the OTP and issue an admin-scoped JWT.

### Response Example
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "jwt",
      "refreshToken": "jwt"
    },
    "user": {
      "id": "uuid",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  }
}
```

### Endpoint
`GET /admin/users`

### Description
Lists all users (Paginated).

### Auth Required
Yes (Admin)

### Endpoint
`GET /admin/users/:id`

### Description
Gets a specific user and their wallets.

### Auth Required
Yes (Admin)

### Endpoint
`POST /admin/users/:id/suspend`  

### Description
Suspends a user account.

### Auth Required
Yes (Admin)

### Endpoint
`POST /admin/users/:id/reinstate`

### Description
Reinstates a suspended user account.

### Auth Required
Yes (Admin)

### Endpoint
`GET /admin/kyc`

### Description
Lists all KYC submissions (Paginated).

### Auth Required
Yes (Admin)

### Endpoint
`POST /admin/kyc/:id/approve`

### Description
Approves a KYC submission and verifies the user.

### Auth Required
Yes (Admin)

### Endpoint
`POST /admin/kyc/:id/reject`

### Description
Rejects a KYC submission with a reason.

### Auth Required
Yes (Admin)

### Request Body
```json
{
  "reason": "Document is not clear"
}
```

### Endpoint
`POST /admin/deposits/:id/approve`

### Description
Approves a pending manual deposit and credits the user's wallet.

### Auth Required
Yes (Admin)

### Endpoint
`POST /admin/deposits/:id/reject`

### Description
Rejects a pending manual deposit.

### Auth Required
Yes (Admin)

---

## Webhooks

### Endpoint
`POST /webhooks/flutterwave`

### Description
Processes Flutterwave webhook events (only `charge.completed`).

### Headers
- `verif-hash`: Flutterwave webhook hash


