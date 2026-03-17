## Project Overview

Sabo Finance is a P2P multi-currency exchange platform backend supporting NGN, GBP, USD, and CAD. Phase 1 focuses on authentication, internal wallet settlement, immutable ledgering, deposits (Flutterwave NGN + manual foreign), KYC, and exchange rates.

## Architecture

- **Wallet system**: Each user has one wallet per currency with `balance` (available) and `locked_balance`.
- **Immutable ledger**: Every financial movement creates an append-only ledger entry (no updates to ledger rows).
- **Transaction safety**: Financial operations run inside TypeORM QueryRunner transactions. Wallet mutations are only allowed via `WalletService`.

## Tech Stack

- Node.js, Express, TypeScript
- PostgreSQL, TypeORM
- Redis, BullMQ
- JWT authentication, bcrypt password hashing

## Installation

```bash
git clone <your-repo>
cd sabo_finance
npm install
cp .env.example .env
```

## Local Infrastructure (Postgres + Redis)

```bash
docker compose up -d
```

This also creates a test DB (`sabo_finance_test`) via `docker/postgres/init/01-create-test-db.sql`.

## Run Migrations

```bash
npm run migration:run
```

## Run Project

```bash
npm run dev
```

## Swagger Docs

Swagger UI is available at:

`http://localhost:3000/api/docs`

## Run Tests

Set `DATABASE_URL_TEST` in `.env` (see `.env.example`), ensure Postgres is running, then:

```bash
npm test
```

## API Reference

See `API_DOCUMENTATION.md`.

