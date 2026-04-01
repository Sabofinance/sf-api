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

Auth-protected endpoints require:

`Authorization: Bearer <accessToken>`

---

## Auth

### POST /auth/register
Registers a new user and automatically creates wallets for NGN, GBP, USD, and CAD.

Request Body:
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348000000000",
  "password": "Password123!"
}
```

### POST /auth/login
Authenticates a user and sends a login OTP to the user's email.

Request Body:
```json
{
  "email": "jane@example.com",
  "password": "Password123!"
}
```

### POST /auth/verify-otp
Verifies the login OTP and returns access and refresh tokens.

Request Body:
```json
{
  "email": "jane@example.com",
  "otp": "123456"
}
```

### POST /auth/refresh-token
Refreshes access and refresh tokens using a valid refresh token.

Request Body:
```json
{
  "refreshToken": "jwt"
}
```

### GET /auth/verify-email
Verifies a new user's email address.

Query Parameters:
- `token` (required): Email verification token.

### GET /auth/me
Returns the currently authenticated user's profile.

Auth Required: Yes

### POST /auth/logout
Logs out the current session. Client should discard tokens.

Auth Required: Yes

### POST /auth/forgot-password
Starts the password reset flow by sending a reset link via email.

Request Body:
```json
{
  "email": "jane@example.com"
}
```

### POST /auth/reset-password
Resets a user's password using a reset token.

Request Body:
```json
{
  "token": "reset-token",
  "password": "NewPassword123!"
}
```

---

## Account

All `/account` routes require authentication.

### PUT /account/username
Change the authenticated user's username.

Request Body:
```json
{
  "username": "new_username_123"
}
```

### POST /account/transaction-pin/set
Set or update the transaction PIN.

Request Body:
```json
{
  "pin": "123456",
  "confirm_pin": "123456"
}
```

### POST /account/transaction-pin/verify
Verify the authenticated user's transaction PIN.

Request Body:
```json
{
  "pin": "123456"
}
```

### POST /account/delete/initiate
Start the account deletion flow and send an OTP to the user's email.

Request Body:
```json
{
  "password": "Password123!"
}
```

### POST /account/delete/confirm
Confirm account deletion with password and OTP.

Request Body:
```json
{
  "password": "Password123!",
  "otp": "123456"
}
```

### POST /account/email-change/initiate
Initiate email change by sending an OTP to the new email and alerting the old email.

Request Body:
```json
{
  "new_email": "new@example.com",
  "password": "Password123!"
}
```

### POST /account/email-change/confirm
Confirm email change with OTP.

Request Body:
```json
{
  "new_email": "new@example.com",
  "otp": "123456"
}
```

---

## Wallets

### GET /wallets
Returns all wallets for the authenticated user.

Auth Required: Yes

### GET /wallets/:currency
Returns a wallet for the authenticated user by currency.

Auth Required: Yes

Path Parameters:
- `currency`: NGN, GBP, USD, CAD

---

## Ledger

### GET /ledger
List ledger entries for the authenticated user.

Auth Required: Yes

Query Parameters:
- `from` (optional): ISO date-time
- `to` (optional): ISO date-time
- `type` (optional): ledger type
- `currency` (optional): NGN, GBP, USD, CAD

### GET /ledger/:walletId
List ledger entries for a specific wallet owned by the authenticated user.

Auth Required: Yes

Path Parameters:
- `walletId`: UUID

---

## Deposits

### POST /deposits/ngn/initiate
Initiate an NGN deposit via Flutterwave. Returns a payment link and deposit record.

Auth Required: Yes

Request Body:
```json
{
  "amount": "5000.00",
  "email": "optional@example.com"
}
```

### POST /deposits/foreign
Submit a manual foreign deposit for GBP, USD, or CAD with proof upload.

Auth Required: Yes

Request (multipart/form-data):
- `currency`: GBP, USD, CAD
- `amount`: string
- `proof`: file

### GET /deposits
List deposits for the authenticated user.

Auth Required: Yes

### GET /deposits/:id
Get a specific deposit by ID owned by the authenticated user.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## Withdrawals

### POST /withdrawals/request
Request a new withdrawal to a saved beneficiary.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "beneficiary_id": "uuid",
  "amount": "1000.00"
}
```

### GET /withdrawals
List withdrawals for the authenticated user.

Auth Required: Yes

### GET /withdrawals/:id
Get a specific withdrawal by ID.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## Beneficiaries

### POST /beneficiaries
Create a new beneficiary for withdrawals.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "currency": "NGN|GBP|USD|CAD",
  "bank_name": "First Bank",
  "account_name": "John Doe",
  "account_number": "1234567890",
  "sort_code": "01-02-03",
  "iban": "GB29NWBK60161331926819"
}
```

### GET /beneficiaries
List beneficiaries for the authenticated user.

Auth Required: Yes

### DELETE /beneficiaries/:id
Delete a beneficiary.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## KYC

### POST /kyc/upload
Upload KYC documents and a selfie. Sets the user's KYC status to `pending`.

Auth Required: Yes

Request (multipart/form-data):
- `document_type`: string
- `document`: file
- `selfie`: file

### GET /kyc/status
Get the current user KYC status and latest submission.

Auth Required: Yes

---

## Exchange Rates

### GET /rates
Returns the latest exchange rates for all currency pairs.

---

## Conversions

### POST /conversions/quote
Get a conversion quote between two currencies.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

### POST /conversions/execute
Execute a currency conversion.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "from": "USD",
  "to": "NGN",
  "amount": "100.00"
}
```

---

## Sabits

### GET /sabits
List active Sabits.

Optional Query Parameters:
- `type`: BUY or SELL
- `currency`: GBP, USD, CAD

### GET /sabits/:id
Get a specific Sabit by ID.

Path Parameters:
- `id`: UUID

### POST /sabits
Create a new Sabit listing.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "type": "BUY|SELL",
  "currency": "GBP|USD|CAD",
  "amount": "100.00",
  "rate_ngn": "1500.00"
}
```

### POST /sabits/:id/cancel
Cancel an active Sabit and release any locked funds.

Auth Required: Yes (Verified User)

Path Parameters:
- `id`: UUID

---

## Bids

### POST /bids
Place a bid on a SELL Sabit.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "sabit_id": "uuid",
  "amount": "100.00",
  "proposed_rate_ngn": "1450.00",
  "pin": "123456"
}
```

### GET /bids/mine
List bids placed by the authenticated user.

Auth Required: Yes

Query Parameters:
- `status` (optional)
- `page` (optional)
- `limit` (optional)

### GET /bids/received
List bids received on the authenticated user's listings.

Auth Required: Yes

Query Parameters:
- `status` (optional)
- `page` (optional)
- `limit` (optional)

### PUT /bids/:id/accept
Accept a pending bid as the seller.

Auth Required: Yes

Request Body:
```json
{
  "pin": "123456"
}
```

Path Parameters:
- `id`: UUID

### PUT /bids/:id/reject
Reject a pending bid as the seller.

Auth Required: Yes

Request Body:
```json
{
  "pin": "123456",
  "reason": "Rate too low for current market."
}
```

Path Parameters:
- `id`: UUID

### PUT /bids/:id/withdraw
Withdraw a pending bid as the buyer.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## Trades

### POST /trades/initiate
Initiate a trade against a Sabit.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "sabit_id": "uuid",
  "amount": "50.00",
  "pin": "123456"
}
```

### PUT /trades/:id/seller-confirm
Seller confirms a trade using their PIN within the 10-minute confirmation window.

Auth Required: Yes

Request Body:
```json
{
  "pin": "123456"
}
```

Path Parameters:
- `id`: UUID

### POST /trades/:id/confirm
Seller confirms payment processing and moves the trade to escrow.

Auth Required: Yes

Path Parameters:
- `id`: UUID

### POST /trades/:id/complete
Seller completes the trade and settles funds from escrow.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## Disputes

### POST /disputes/raise
Raise a dispute for a completed or in-progress trade.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "trade_id": "uuid",
  "reason": "Detailed reason for the dispute (min 20 chars)"
}
```

### GET /disputes
List disputes for the authenticated user.

Auth Required: Yes

### GET /disputes/:id
Get a specific dispute by ID.

Auth Required: Yes

Path Parameters:
- `id`: UUID

---

## Ratings

### POST /ratings
Submit a rating after a completed trade.

Auth Required: Yes (Verified User)

Request Body:
```json
{
  "trade_id": "uuid",
  "score": 5,
  "comment": "Excellent counterparty."
}
```

### GET /ratings/user/:id
Get a user's reputation and recent reviews.

Path Parameters:
- `id`: UUID

---

## Notifications

### GET /notifications
List notifications for the authenticated user.

Auth Required: Yes

Query Parameters:
- `page` (optional)
- `limit` (optional)

### PATCH /notifications/:id/read
Mark a specific notification as read.

Auth Required: Yes

Path Parameters:
- `id`: UUID

### POST /notifications/mark-all-read
Mark all authenticated user notifications as read.

Auth Required: Yes

---

## Admin

### POST /admin/auth/login
Admin login step 1: verify password and send OTP.

Request Body:
```json
{
  "email": "admin@example.com",
  "password": "AdminPassword123!"
}
```

### POST /admin/auth/verify-otp
Admin login step 2: verify OTP and receive admin JWT.

Request Body:
```json
{
  "email": "admin@example.com",
  "otp": "123456"
}
```

### GET /admin/invites/accept
Accept an admin invite token. Public endpoint.

Query Parameters:
- `token`: string

### POST /admin/invites
Create a one-time admin invite (super admin only).

Auth Required: Yes (Super Admin)

Request Body:
```json
{
  "email": "newadmin@example.com"
}
```

### POST /admin/admins/:id/remove
Remove admin rights from a user.

Auth Required: Yes (Super Admin)

Path Parameters:
- `id`: UUID

### POST /admin/admins/:id/upgrade
Upgrade an admin to super admin.

Auth Required: Yes (Super Admin)

Path Parameters:
- `id`: UUID

### GET /admin/users
List all users.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

### GET /admin/users/:id
Get a specific user and their wallets.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### POST /admin/users/:id/suspend
Suspend a user account.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### POST /admin/users/:id/reinstate
Reinstate a suspended user account.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### GET /admin/profile
Get the authenticated admin profile.

Auth Required: Yes (Admin)

### POST /admin/profile/picture
Update the authenticated admin's profile picture.

Auth Required: Yes (Admin)

Request (multipart/form-data):
- `file`: image

### GET /admin/logs
List admin logs. Regular admins see own logs; super admins see all.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

### GET /admin/kyc
List all KYC submissions.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

### POST /admin/kyc/:id/approve
Approve a KYC submission.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### POST /admin/kyc/:id/reject
Reject a KYC submission.

Auth Required: Yes (Admin)

Request Body:
```json
{
  "reason": "Document is not clear"
}
```

Path Parameters:
- `id`: UUID

### POST /admin/deposits/:id/approve
Approve a manual or pending NGN deposit.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### POST /admin/deposits/:id/reject
Reject a manual deposit.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### POST /admin/deposits/:id/verify-flutterwave
Manually verify an initiated NGN Flutterwave deposit and credit the wallet.

Auth Required: Yes (Admin)

Path Parameters:
- `id`: UUID

### GET /admin/dashboard
Get admin dashboard statistics.

Auth Required: Yes (Admin)

### GET /admin/analytics/impact
Get admin impact and system analytics.

Auth Required: Yes (Admin)

### GET /admin/deposits
List all deposits across the platform.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

### GET /admin/disputes
List all disputes across the platform.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

### GET /admin/transactions
List all ledger transactions across the platform.

Auth Required: Yes (Admin)

Query Parameters:
- `page` (optional)
- `limit` (optional)

---

## Webhooks 

### POST /webhooks/flutterwave
Process Flutterwave webhook events.

Headers:
- `verif-hash`: Flutterwave webhook signature header

Always returns HTTP 200.
 