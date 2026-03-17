## Sabo Finance API Documentation (Phase 1)

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
{ "name": "Jane Doe", "email": "jane@example.com", "phone": "+2348000000000", "password": "Password123!" }
```

### Response Example
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "jane@example.com" },
    "tokens": { "accessToken": "jwt", "refreshToken": "jwt" }
  },
  "meta": {},
  "error": null
}
```

### Error Responses
- `VALIDATION_ERROR`
- `INTERNAL_ERROR`

### Endpoint
`POST /auth/login`

### Description
Authenticates a user and returns access/refresh tokens.

### Request Body
```json
{ "email": "jane@example.com", "password": "Password123!" }
```

### Response Example
```json
{ "success": true, "data": { "tokens": { "accessToken": "jwt", "refreshToken": "jwt" } }, "meta": {}, "error": null }
```

### Error Responses
- `UNAUTHORIZED` (invalid credentials)

### Endpoint
`POST /auth/logout`

### Description
Logout endpoint (Phase 1: client discards tokens).

### Auth Required
Yes

---

## Wallets

### Endpoint
`GET /wallets`

### Description
Returns all wallets for authenticated user.

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
Lists ledger entries for a wallet (must belong to user).

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
{ "amount": "5000.00" }
```

### Endpoint
`POST /webhooks/flutterwave`

### Description
Processes Flutterwave webhook events (only `charge.completed`). Always returns `200`.

### Headers
- `verif-hash`: Flutterwave webhook hash

### Endpoint
`GET /deposits`

### Description
List deposits for authenticated user.

### Auth Required
Yes

### Endpoint
`GET /deposits/:id`

### Description
Get deposit by id (owned by authenticated user).

### Auth Required
Yes

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

---

## Admin Deposits

### Endpoint
`POST /admin/deposits/:id/approve`

### Description
Approves a pending manual deposit and credits the user wallet via walletService (ledger entry created).

### Auth Required
Yes (admin)

### Endpoint
`POST /admin/deposits/:id/reject`

### Description
Rejects a pending manual deposit.

### Auth Required
Yes (admin)

---

## Exchange Rates

### Endpoint
`GET /rates`

### Description
Returns latest exchange rate rows (latest per `pair`).

---

## KYC

### Endpoint
`POST /kyc/upload`

### Description
Uploads KYC document and selfie (Cloudinary) and sets user KYC status to `pending`.

### Auth Required
Yes

### Request (multipart/form-data)
- `document_type`: string
- `document`: file
- `selfie`: file

### Endpoint
`GET /kyc/status`

### Description
Returns user KYC status and latest KYC record (if any).

### Auth Required
Yes

