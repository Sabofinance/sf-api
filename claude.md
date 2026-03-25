# Sabo Finance Backend - AI Assistant Guidelines

Welcome to the Sabo Finance backend codebase. You are an expert TypeScript backend engineer. Your goal is to write clean, secure, and production-ready code that adheres strictly to the existing architectural patterns of this project.

## 1. Project Overview & Architecture
Sabo Finance is a multi-currency P2P exchange platform. 
*   **Tech Stack**: Node.js, Express.js, TypeScript, PostgreSQL, TypeORM, Zod (validation), Jest/Supertest (testing).
*   **Architecture**: Modular monolith. Features are grouped by domain in `src/modules/` (e.g., auth, trades, wallets).
*   **Data Integrity**: This is a financial application. Data integrity is paramount. All money movements MUST use the `Ledger` system and execute within database transactions.

## 2. Directory Structure
*   `src/modules/`: Domain logic. Each folder contains its own `controller`, `routes`, and optionally `services`.
*   `src/database/entities/`: TypeORM entity definitions.
*   `src/database/migrations/`: Database schema changes.
*   `src/database/transaction.ts`: Contains the crucial `withTransaction` helper.
*   `src/services/`: Shared, cross-domain services (e.g., `emailService.ts`, `walletService.ts`).
*   `src/middleware/`: Express middlewares (Auth, KYC, Error handling).
*   `tests/`: Jest test suites, specifically `all-endpoints.smoke.test.ts`.

## 3. Strict Coding Rules

### A. Database & Transactions (CRITICAL)
1.  **Always use `withTransaction`**: Any operation that modifies data (INSERT/UPDATE/DELETE) MUST be wrapped in the `withTransaction(async (qr) => { ... })` helper from `src/database/transaction.ts`.
2.  **Use QueryRunner**: Inside the transaction block, you MUST use the provided `qr` (QueryRunner) to execute queries. NEVER use `AppDataSource.query` or `Entity.save` inside a transaction block, as they will escape the transaction scope.
3.  **Raw SQL preference**: For complex logic, especially involving locks (`FOR UPDATE`), raw SQL via `qr.query` is preferred over TypeORM's query builder for explicit control.
4.  **Decimals**: Financial amounts are stored as `numeric(18,2)` in Postgres and passed as `string` in TypeScript/JSON to prevent floating-point errors.

### B. TypeORM Migrations
1.  **Never auto-synchronize**: `synchronize: false` is strictly enforced.
2.  **Explicit Migrations**: If you create or modify an entity in `src/database/entities/`, you MUST generate or manually write a corresponding migration in `src/database/migrations/`.
3.  **Definite Assignment**: Entity properties must use the `!` operator (e.g., `id!: string`) to satisfy TypeScript's strict initialization rules.

### C. Request Handling & Validation
1.  **Zod Validation**: All incoming request bodies, params, and queries MUST be validated using `zod` schemas at the very top of the controller function.
2.  **AsyncHandler**: Every controller function mounted in a router MUST be wrapped in `asyncHandler` from `src/utils/asyncHandler.ts` to catch unhandled promise rejections.
3.  **Standard Responses**: Use the utility functions from `src/utils/apiResponse.ts` (`ok`, `created`, `fail`) to ensure a consistent JSON response structure.
4.  **Custom Errors**: Throw custom errors from `src/utils/errors.ts` (e.g., `AppError`, `NotFoundError`, `UnauthorizedError`). The global error handler will catch them.

### D. TypeScript & Style
1.  **No `any`**: The use of `any` is strictly forbidden. Define proper interfaces or use `unknown` if truly dynamic.
2.  **Local Imports**: Use relative local paths (e.g., `../../utils/enums`) instead of `@/` aliases.
3.  **AuthUser Type**: When accessing `req.user`, rely on the globally augmented `Express.Request` type defined in `src/types/declarations.d.ts`.

## 4. Testing Protocols
1.  **Test Environment**: Tests run against a dedicated database (`sabo_finance_test`).
2.  **Test Migrations**: Before running tests, migrations must be applied using `npm run migration:run:test`.
3.  **No External Calls**: Tests must not hit live external APIs (like Flutterwave or SMTP). Ensure mocks or environment bypasses (like the `NODE_ENV === 'test'` check in `emailService.ts`) are utilized.
4.  **Smoke Tests**: Any new major feature must have coverage added to `tests/all-endpoints.smoke.test.ts`.

## 5. Deployment Context
*   **Environment**: Deployed on Render.
*   **Dotenv**: Do not use `dotenv` to load files in production. Rely on injected environment variables. Use `if (process.env.NODE_ENV !== 'production') { dotenv.config(); }`.
*   **Build**: Test files are excluded from the production build via `tsconfig.json`.

**When asked to implement a feature, always consider the database schema first, generate the migration, write the Zod validation, implement the controller logic inside a transaction, and finally document it with Swagger comments.**