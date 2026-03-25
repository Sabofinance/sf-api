Here is the full prompt:

---

**You are working on the Sabo Finance backend codebase. The existing system is a fully functional P2P multi-currency exchange platform. You are now implementing three new feature sets. Read the full instructions before writing any code. Follow the existing codebase patterns exactly as described in CLAUDE.md.**

**Before starting any phase, read CLAUDE.md in full. Every pattern, transaction rule, wallet service rule, response format, and testing requirement described there applies to everything you build here.**

---

## PHASE 1 — Unique Username System

### What to Build

Every user must have a unique username assigned automatically at registration. Users can change their username later to a custom nickname. Usernames must always be unique across the platform.

### Database Changes

Add a migration that adds a `username` column to the `users` table:

```sql
ALTER TABLE "users" ADD COLUMN "username" varchar(30) NOT NULL UNIQUE;
CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username");
```

The column is NOT NULL and has a unique constraint. The migration must handle existing users by generating a username for them before adding the NOT NULL constraint — use a two-step migration: add as nullable, populate, then set NOT NULL.

### Username Generation Logic

Write a `usernameService.ts` in `src/services/`:

```
generateUsername(name: string): string
```

The algorithm:
1. Take the user's first name, lowercase it, strip non-alphanumeric characters
2. Append a random 4-digit number: e.g. `pelumi4821`
3. Check if it already exists in the database
4. If it does, regenerate with a new random number and retry up to 10 times
5. If all 10 attempts collide, fall back to `user` + 8 random digits: `user48291034`
6. Return the unique username

Call `generateUsername` inside the registration transaction before the user row is inserted. The username must be saved as part of the initial user creation — never as a separate step.

### Username Change Endpoint

```
PUT /account/username
```

Authenticated. No KYC required.

Zod schema:
```typescript
const schema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .toLowerCase()
});
```

Business rules:
- Check uniqueness before saving — if taken, return `AppError` with code `USERNAME_TAKEN` and HTTP 409
- The new username must pass the regex — no spaces, no special characters except underscore
- Update inside `withTransaction`
- Log the change in `admin_logs` with action `USERNAME_CHANGED`, target_type `user`, details containing the old and new username
- Return the updated user profile in the response

### Update Existing Endpoints

- `POST /auth/register` response must include `username` in the returned user object
- `GET /auth/me` response must include `username`
- Any endpoint that returns a user profile must include `username`
- The `User` entity must include the `username` field

### Swagger

Document the new `PUT /account/username` endpoint fully. Update the register and me endpoint response schemas to include `username`.

### Tests

Write unit tests for `usernameService` covering:
- Happy path — unique username generated successfully
- Collision on first attempt — retries and finds unique
- All 10 attempts collide — falls back to `user` + 8 digits
- Name with special characters — strips correctly

Write integration tests for `PUT /account/username` covering:
- Success — username changed
- Username already taken — 409 returned
- Username fails regex — 400 returned
- Unauthenticated — 401 returned

Add username assertion to `tests/all-endpoints.smoke.test.ts` — verify that the registered user has a `username` field in the registration response.

Run all tests and confirm they pass before moving to Phase 2.

---

## PHASE 2 — Transaction PIN System

### What to Build

Both buyers and sellers must enter a 6-digit transaction PIN to authorise the final stage of a trade. The PIN is set once during account setup and used at the point of trade execution. The seller is notified when a buyer initiates a trade and has 10 minutes to confirm using their PIN. Both parties receive email and in-app notifications when the trade completes.

### Database Changes

Write a migration that adds the following to the `users` table:

```sql
ALTER TABLE "users" ADD COLUMN "transaction_pin_hash" varchar(255) NULL;
ALTER TABLE "users" ADD COLUMN "transaction_pin_set" boolean NOT NULL DEFAULT false;
```

Write a migration that adds the following to the `trades` table:

```sql
ALTER TABLE "trades" ADD COLUMN "buyer_pin_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "trades" ADD COLUMN "seller_pin_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "trades" ADD COLUMN "pin_expires_at" timestamptz NULL;
ALTER TABLE "trades" ADD COLUMN "seller_notified_at" timestamptz NULL;
```

### PIN Setup Endpoints

```
POST /account/transaction-pin/set
```

Authenticated. Sets or updates the transaction PIN.

Zod schema:
```typescript
const schema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  confirm_pin: z.string().length(6)
}).refine(data => data.pin === data.confirm_pin, {
  message: 'PINs do not match',
  path: ['confirm_pin']
});
```

Business rules:
- Hash the PIN using bcrypt with salt rounds 10 — never store plain text
- Set `transaction_pin_hash` and `transaction_pin_set = true` on the user
- Send a `PIN_SET` email notification confirming the PIN was set or changed
- Wrap in `withTransaction`

```
POST /account/transaction-pin/verify
```

Internal utility endpoint — not called directly by trade flow but available for PIN validation confirmation. Accepts `{ pin: string }`, returns whether the PIN is valid for the authenticated user. Used for testing purposes.

### PIN Verification Service

Write a `pinService.ts` in `src/services/`:

```typescript
verifyPin(userId: string, pin: string, qr: QueryRunner): Promise<boolean>
requirePinSet(userId: string, qr: QueryRunner): Promise<void>  // throws if pin not set
```

`verifyPin` fetches the user's `transaction_pin_hash` and uses `bcrypt.compare`. Returns `true` or `false`. Never throws on mismatch — let the caller decide how to handle.

`requirePinSet` throws `AppError('PIN_NOT_SET', 'You must set a transaction PIN before trading', 400)` if `transaction_pin_set` is false.

### Modified Trade Initiation Flow

When a buyer initiates a trade via `POST /trades` (accepts a sabit listing), the flow changes as follows:

**Step 1 — Pre-checks (before any money moves)**
- Call `pinService.requirePinSet(buyerId)` — throw if buyer has no PIN set
- Call `pinService.requirePinSet(sellerId)` — throw if seller has no PIN set with message `'The seller has not set a transaction PIN. This trade cannot proceed.'`

**Step 2 — Buyer PIN verification at trade initiation**
The request body must now include the buyer's PIN:
```typescript
const schema = z.object({
  sabit_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits')
});
```

- Verify the buyer's PIN via `pinService.verifyPin`
- If invalid: return `AppError('INVALID_PIN', 'Incorrect transaction PIN', 401)` — do NOT lock funds, do NOT create a trade record
- If valid: proceed with trade creation
- Set `buyer_pin_verified = true` on the trade record
- Set `pin_expires_at = NOW() + INTERVAL '10 minutes'` on the trade record

**Step 3 — Fund locking and escrow (same as before)**
Lock seller funds, debit buyer NGN — all inside `withTransaction` as currently implemented.

**Step 4 — Notify seller**
After the transaction commits successfully, send:

Email to seller (`TRADE_INITIATED_SELLER` template):
```
Subject: Action Required — New Trade Request
Body: A buyer has initiated a trade against your listing.
      Trade reference: {reference}
      Currency: {currency}
      Amount: {amount}
      Rate: {rate_ngn} NGN
      You have 10 minutes to confirm this trade using your transaction PIN.
      If you do not confirm within 10 minutes, the trade will be automatically cancelled.
```

In-app notification to seller:
```
type: TRADE_INITIATED_SELLER
title: New Trade Request
body: A buyer wants to trade {amount} {currency} at ₦{rate_ngn}. You have 10 minutes to confirm.
```

Set `seller_notified_at = NOW()` on the trade record.

### Seller PIN Confirmation Endpoint

```
PUT /trades/:id/seller-confirm
```

Authenticated. Seller only.

Zod schema:
```typescript
const schema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits')
});
```

Business rules:
- Verify the requesting user is the seller on this trade — throw `ForbiddenError` if not
- Check trade status is `escrowed` — throw `AppError('INVALID_TRADE_STATE', 'Trade is not awaiting seller confirmation', 400)` if not
- Check `pin_expires_at` — if `NOW() > pin_expires_at`, automatically cancel the trade, release all locked funds, send cancellation notifications to both parties, and return `AppError('PIN_EXPIRED', 'The 10-minute confirmation window has expired. This trade has been cancelled.', 400)`
- Verify seller PIN via `pinService.verifyPin` — if invalid, return `AppError('INVALID_PIN', 'Incorrect transaction PIN', 401)` — do NOT cancel the trade on wrong PIN, allow retry
- If PIN valid: set `seller_pin_verified = true`, update trade status to `confirmed`
- Send in-app notification to buyer: `'The seller has confirmed the trade. Payment is now in progress.'`

### PIN Expiry Background Job

Write a BullMQ cron job that runs every minute:

```typescript
// Finds all trades in 'escrowed' status where pin_expires_at < NOW()
// and seller_pin_verified = false
// For each expired trade:
//   1. Open withTransaction
//   2. Release buyer's locked NGN back to available
//   3. Release seller's locked/escrowed foreign currency back to available
//   4. Create ledger reversal entries for both
//   5. Update trade status to 'cancelled'
//   6. Send PIN_EXPIRED_CANCELLATION email to both parties
//   7. Send in-app notification to both parties
```

This job is the safety net — it ensures no funds are stuck in limbo if a seller never responds.

### Trade Completion Notifications

When a trade reaches `completed` status (seller releases funds after confirming payment received — the existing `PUT /trades/:id/release` endpoint), send the following after the transaction commits:

Email to buyer (`TRADE_COMPLETED_BUYER` template):
```
Subject: Trade Completed — {reference}
Body: Your trade has been completed successfully.
      You received: {amount} {currency}
      Trade reference: {reference}
      Rate: {rate_ngn} NGN per unit
```

Email to seller (`TRADE_COMPLETED_SELLER` template):
```
Subject: Trade Completed — {reference}
Body: Your trade has been completed successfully.
      You received: {total_ngn} NGN
      Trade reference: {reference}
```

In-app notification to both parties:
```
type: TRADE_COMPLETED
title: Trade Completed
body: Trade {reference} has been completed successfully.
```

### Email Templates

Create the following HTML templates in `src/templates/emails/`:
- `trade-initiated-seller.html`
- `trade-completed-buyer.html`
- `trade-completed-seller.html`
- `pin-set.html`
- `pin-expired-cancellation.html`

Each template must use `{{variable}}` placeholders consistent with the existing email service template rendering system.

### Swagger

Document all new and modified endpoints fully:
- `POST /account/transaction-pin/set`
- `POST /account/transaction-pin/verify`
- `PUT /trades/:id/seller-confirm`
- Update `POST /trades` docs to show the `pin` field is now required

### Tests

Unit tests for `pinService`:
- `verifyPin` returns true on correct PIN
- `verifyPin` returns false on incorrect PIN
- `requirePinSet` throws when PIN not set
- `requirePinSet` does not throw when PIN is set

Integration tests:
- `POST /account/transaction-pin/set` — success, PIN mismatch, not 6 digits
- `POST /trades` — fails when buyer has no PIN, fails when seller has no PIN, fails on wrong PIN, succeeds on correct PIN, trade record has `buyer_pin_verified = true` and `pin_expires_at` set
- `PUT /trades/:id/seller-confirm` — success, wrong user, expired window (auto-cancel), wrong PIN (allows retry), trade moves to `confirmed`

Add PIN flow coverage to `tests/all-endpoints.smoke.test.ts`:
- Set PIN for test user before initiating a trade
- Pass PIN in trade initiation request
- Call seller confirm with PIN
- Verify trade reaches `confirmed` state

Run all tests and confirm they pass before moving to Phase 3.

---

## PHASE 3 — Buyer Bid System

### What to Build

When a buyer initiates a trade against a SELL listing, they can optionally submit a bid offering a lower rate than the seller's listed rate. The seller receives an email and in-app notification about the bid and can accept or reject it. If accepted, the trade proceeds at the bid rate. If rejected, the buyer is notified and the bid is closed. Standard trades with no bid continue to work exactly as before.

### Database Changes

Write a migration that creates the `bids` table:

```sql
CREATE TYPE "bid_status_enum" AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'withdrawn');

CREATE TABLE "bids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference" varchar(32) NOT NULL UNIQUE,
  "sabit_id" uuid NOT NULL REFERENCES "sabits" ("id") ON DELETE RESTRICT,
  "buyer_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "seller_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "currency" "currency_enum" NOT NULL,
  "amount" numeric(18,2) NOT NULL,
  "proposed_rate_ngn" numeric(18,2) NOT NULL,
  "original_rate_ngn" numeric(18,2) NOT NULL,
  "total_ngn_at_bid_rate" numeric(18,2) NOT NULL,
  "status" "bid_status_enum" NOT NULL DEFAULT 'pending',
  "buyer_pin_verified" boolean NOT NULL DEFAULT false,
  "expires_at" timestamptz NOT NULL,
  "seller_responded_at" timestamptz NULL,
  "rejection_reason" text NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "IDX_bids_sabit" ON "bids" ("sabit_id");
CREATE INDEX "IDX_bids_buyer" ON "bids" ("buyer_id");
CREATE INDEX "IDX_bids_seller" ON "bids" ("seller_id");
CREATE INDEX "IDX_bids_status" ON "bids" ("status");
CREATE UNIQUE INDEX "IDX_bids_reference" ON "bids" ("reference");
```

Add the `Bid` entity to `src/database/entities/Bid.ts` and register it in both data sources.

Write a migration that adds `bid_id` to the `trades` table:

```sql
ALTER TABLE "trades" ADD COLUMN "bid_id" uuid NULL REFERENCES "bids" ("id") ON DELETE SET NULL;
```

Add `reference_sequences` entry handling for bids: prefix `BID`.

### Place a Bid Endpoint

```
POST /bids
```

Authenticated. Requires KYC.

Zod schema:
```typescript
const schema = z.object({
  sabit_id: z.string().uuid('Invalid listing ID'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount'),
  proposed_rate_ngn: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid rate'),
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits')
});
```

Business rules:
- Load the sabit — must exist, status must be `active`, type must be `SELL`
- The buyer cannot bid on their own listing — throw `AppError('CANNOT_BID_OWN_LISTING', 'You cannot bid on your own listing', 400)`
- `proposed_rate_ngn` must be strictly less than the sabit's `rate_ngn` — bids must offer a lower price. If equal or higher, throw `AppError('BID_RATE_TOO_HIGH', 'Your bid rate must be lower than the listing rate', 400)`
- `amount` must be less than or equal to `sabit.available_amount` — throw `AppError('INSUFFICIENT_LISTING_AMOUNT', 'The requested amount exceeds what is available on this listing', 400)`
- Check the buyer does not already have a `pending` bid on this same sabit — throw `AppError('DUPLICATE_BID', 'You already have a pending bid on this listing', 400)`
- Call `pinService.requirePinSet` for buyer — throw if not set
- Verify buyer PIN via `pinService.verifyPin` — throw `AppError('INVALID_PIN', 'Incorrect transaction PIN', 401)` if wrong. Do NOT create any bid record on wrong PIN.
- Calculate `total_ngn_at_bid_rate = amount * proposed_rate_ngn`
- Lock the buyer's NGN: `total_ngn_at_bid_rate` moves to `locked_balance` via `walletService.lock` — this holds the buyer's funds during the bid window. If the bid is rejected or expires the lock is released.
- Create a ledger entry for the NGN lock with type `escrow_hold` and related_id set to the bid id
- Set `expires_at = NOW() + INTERVAL '24 hours'` — bids expire after 24 hours if not responded to
- Set `buyer_pin_verified = true`
- Generate bid reference using the `BID-YYYY-XXXXXX` format
- All of the above inside `withTransaction`

After transaction commits, send:

Email to seller (`BID_PLACED_SELLER` template):
```
Subject: New Bid on Your Listing — {reference}
Body: A buyer has placed a bid on your {currency} listing.
      Listing rate: ₦{original_rate_ngn}
      Bid rate: ₦{proposed_rate_ngn}
      Amount: {amount} {currency}
      Value at bid rate: ₦{total_ngn_at_bid_rate}
      This bid expires in 24 hours. Log in to accept or reject it.
```

In-app notification to seller:
```
type: BID_PLACED
title: New Bid Received
body: Someone offered ₦{proposed_rate_ngn} for your {currency} listing. Tap to review.
```

Email to buyer (`BID_PLACED_BUYER` template):
```
Subject: Your Bid Has Been Placed — {reference}
Body: Your bid has been submitted successfully.
      Bid reference: {reference}
      Proposed rate: ₦{proposed_rate_ngn}
      Amount: {amount} {currency}
      Your funds of ₦{total_ngn_at_bid_rate} are held pending the seller's response.
```

In-app notification to buyer:
```
type: BID_PLACED_CONFIRMATION
title: Bid Placed
body: Your bid of ₦{proposed_rate_ngn} per {currency} is pending seller review.
```

Return the created bid in the response with HTTP 201.

### Get My Bids Endpoint

```
GET /bids/mine?status=pending&page=1&limit=20
```

Authenticated. Returns paginated list of all bids placed by the authenticated user. Filterable by status.

### Get Bids on My Listings Endpoint

```
GET /bids/received?status=pending&page=1&limit=20
```

Authenticated. Returns paginated list of all bids placed on the authenticated user's listings. Filterable by status.

### Accept a Bid Endpoint

```
PUT /bids/:id/accept
```

Authenticated. Seller only.

Zod schema:
```typescript
const schema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits')
});
```

Business rules:
- Load the bid — must exist and status must be `pending`
- Verify requesting user is the seller on the bid — throw `ForbiddenError` if not
- Check `expires_at` — if expired, mark bid as `expired`, release buyer's locked NGN, send expiry notifications, return `AppError('BID_EXPIRED', 'This bid has expired', 400)`
- Verify seller PIN — throw `AppError('INVALID_PIN', ...)` if wrong. Allow retry — do not reject the bid on wrong PIN.
- Call `pinService.requirePinSet` for seller
- Inside `withTransaction`:
  - Mark bid as `accepted`, set `seller_responded_at = NOW()`
  - Lock the seller's foreign currency: `walletService.lock(sellerId, currency, amount, qr)`
  - The buyer's NGN was already locked when the bid was placed — move it to escrow status by updating the trade
  - Create the trade record at the `proposed_rate_ngn` (not the original listing rate), set `bid_id` to the bid id, status `escrowed`, `buyer_pin_verified = true`, `seller_pin_verified = true` (both PINs already verified during bid and accept flow), set `pin_expires_at = NOW() + INTERVAL '10 minutes'`
  - Decrement `sabit.available_amount` by the bid amount
  - Create ledger entries for seller fund lock
  - The trade is created in `escrowed` state and proceeds through the normal `PUT /trades/:id/release` flow from here

After transaction commits, send:

Email to buyer (`BID_ACCEPTED_BUYER` template):
```
Subject: Your Bid Was Accepted — {reference}
Body: Great news — the seller has accepted your bid.
      Trade reference: {trade_reference}
      Agreed rate: ₦{proposed_rate_ngn}
      Amount: {amount} {currency}
      Please complete your payment to the seller.
```

In-app notification to buyer:
```
type: BID_ACCEPTED
title: Bid Accepted
body: Your bid of ₦{proposed_rate_ngn} per {currency} has been accepted. Complete your payment now.
```

Email to seller (`BID_ACCEPTED_SELLER` template):
```
Subject: You Accepted a Bid — {reference}
Body: You have accepted the buyer's bid. A trade has been created.
      Trade reference: {trade_reference}
      Agreed rate: ₦{proposed_rate_ngn}
```

In-app notification to seller:
```
type: BID_ACCEPTED_CONFIRMATION
title: Bid Accepted
body: You accepted the bid. Trade {trade_reference} is now in progress.
```

Return the created trade record in the response.

### Reject a Bid Endpoint

```
PUT /bids/:id/reject
```

Authenticated. Seller only.

Zod schema:
```typescript
const schema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be 6 digits'),
  reason: z.string().max(500).optional()
});
```

Business rules:
- Load the bid — must exist and status must be `pending`
- Verify requesting user is the seller — throw `ForbiddenError` if not
- Check expiry — same as accept flow
- Verify seller PIN — throw if wrong, allow retry
- Inside `withTransaction`:
  - Mark bid as `rejected`, set `seller_responded_at = NOW()`, set `rejection_reason` if provided
  - Release the buyer's locked NGN: `walletService.unlock(buyerId, 'NGN', total_ngn_at_bid_rate, qr)`
  - Create ledger reversal entry for the NGN release
- After transaction commits, send:

Email to buyer (`BID_REJECTED_BUYER` template):
```
Subject: Your Bid Was Not Accepted — {reference}
Body: The seller has declined your bid.
      Bid reference: {reference}
      Proposed rate: ₦{proposed_rate_ngn}
      {rejection_reason if provided}
      Your funds of ₦{total_ngn_at_bid_rate} have been released back to your wallet.
```

In-app notification to buyer:
```
type: BID_REJECTED
title: Bid Not Accepted
body: The seller declined your bid of ₦{proposed_rate_ngn}. Your funds have been returned.
```

### Withdraw a Bid Endpoint

```
PUT /bids/:id/withdraw
```

Authenticated. Buyer only. Allows the buyer to cancel a pending bid before the seller responds.

Business rules:
- Load bid — must be `pending`
- Verify user is the buyer
- Inside `withTransaction`:
  - Mark bid as `withdrawn`
  - Release buyer's locked NGN
  - Create ledger reversal entry
- No notifications required for buyer-initiated withdrawal

### Bid Expiry Background Job

Write a BullMQ cron job that runs every 5 minutes:

```typescript
// Finds all bids in 'pending' status where expires_at < NOW()
// For each expired bid:
//   1. Open withTransaction
//   2. Mark bid as 'expired'
//   3. Release buyer's locked NGN via walletService.unlock
//   4. Create ledger reversal entry
//   5. Send BID_EXPIRED email to buyer
//   6. Send in-app notification to buyer
```

### Email Templates

Create the following in `src/templates/emails/`:
- `bid-placed-seller.html`
- `bid-placed-buyer.html`
- `bid-accepted-buyer.html`
- `bid-accepted-seller.html`
- `bid-rejected-buyer.html`
- `bid-expired-buyer.html`

### Swagger

Document all new endpoints fully:
- `POST /bids`
- `GET /bids/mine`
- `GET /bids/received`
- `PUT /bids/:id/accept`
- `PUT /bids/:id/reject`
- `PUT /bids/:id/withdraw`

### Tests

Unit tests:
- Bid rate validation — equal to listing rate rejected, higher rejected, lower accepted
- Duplicate bid detection
- PIN verification integrated correctly — no bid created on wrong PIN
- Expiry check on accept and reject

Integration tests:
- `POST /bids` — success, own listing rejected, rate too high rejected, duplicate bid rejected, wrong PIN rejected, buyer NGN locked on success
- `PUT /bids/:id/accept` — success, wrong user rejected, expired bid rejected, wrong PIN allows retry, trade created at bid rate with bid_id set
- `PUT /bids/:id/reject` — success, buyer NGN released on rejection
- `PUT /bids/:id/withdraw` — success, buyer NGN released

Add to `tests/all-endpoints.smoke.test.ts`:
- Buyer places a bid with valid PIN
- Seller rejects the bid — verify buyer NGN is released
- Buyer places a second bid — seller accepts — verify trade created at bid rate, both wallets in correct state

---

## Final Verification — Run After All Three Phases

After completing all three phases, run the following in order and confirm everything passes:

```bash
# Apply all new migrations to test database
npm run migration:run:test

# Run full test suite
npm test

# Run with coverage — must be above 80%
npx jest --coverage --verbose
```

Verify the following manually:
- `GET /auth/me` returns `username` field
- `POST /auth/register` returns `username` in response
- A user without a PIN cannot initiate a trade or place a bid
- A trade with a PIN that expires auto-cancels and releases funds
- A bid that expires auto-releases the buyer's locked NGN
- A bid accepted at a lower rate creates a trade at the bid rate, not the listing rate
- Swagger at `/api/docs` shows all new endpoints with complete schemas

Do not consider any phase complete until all tests for that phase pass. Do not start the next phase until the current phase is fully tested and verified.