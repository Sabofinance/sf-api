---
title: Technical Impact Brief — Security and Integrity Architecture of Sabo Finance
criterion: Tech Nation Global Talent (Digital Technology) — Optional Criterion 3
document: B
date: 19 August 2026
pages: 3
---

# Technical Impact Brief

**Product:** Sabo Finance (sf-api) — product-led P2P multi-currency exchange  
**Scope:** Backend security, financial integrity, and operator threat visibility  
**Period of work:** March 2026 – August 2026  
**Author (applicant):** [Legal name] — Backend / security engineer  
**Criterion:** Optional Criterion 3 — significant technical contribution as an employee/contributor on a product-led digital technology company  

This document is limited to **the applicant’s personal technical contribution**. It is not a company brochure.

---

## 1. Product context

Sabo Finance is a **product-led** digital platform on which users hold and move value in **NGN, GBP, USD, and CAD**. Settlement is **internal only**: users fund Sabo wallets first; there are no peer-to-peer bank transfers between users. Every financial movement must produce an **append-only ledger row**. Wallet balances cannot be mutated except through `WalletService`.

The security problem is therefore not “add login.” It is to make a live exchange **tamper-resistant, attributable, and operable**: stolen tokens, forged payment webhooks, privilege escalation, unverified users trading, and duplicate settlement must fail closed and leave an audit trail.

---

## 2. Architecture (security-critical path)

```
Client
  │  Bearer JWT
  ▼
authMiddleware ──► live user check (suspended / deleted)
  │
  ├─ requireVerifiedUser (KYC) ──► deposits, trades, withdrawals, conversions
  ├─ adminMiddleware + requirePermission() ──► /admin/*
  │
  ▼
WalletService (credit / debit / lock / unlock / transfer)
  │  TypeORM QueryRunner transaction + SELECT … FOR UPDATE
  ▼
wallets.balance / locked_balance     +     ledger (INSERT only)

Flutterwave ── verif-hash (timing-safe) ── amount/currency match ── replay guard
                    │
                    └── security_events ── threat score ── /admin/security/*
```

**Invariant I specified and enforced:** if a financial step fails, the QueryRunner rolls back. Partial wallet writes are not allowed.

---

## 3. Personal contributions (named artefacts)

| # | Decision / delivery | Where |
|---|---------------------|--------|
| 1 | **Single mutation path.** All credits/debits go through `WalletService`; each call writes `balance_before` / `balance_after` to `ledger`. Race conditions are blocked with row locks. | `src/services/walletService.ts` |
| 2 | **Payment webhook authenticity.** Flutterwave `verif-hash` compared with `crypto.timingSafeEqual`. Missing/invalid signatures are logged and **must not credit**. Always HTTP 200 to the provider. | `src/providers/payments/FlutterwaveProvider.ts`, `src/modules/deposits/deposits.controller.ts` |
| 3 | **Settlement integrity.** Credit only if currency and amount match the deposit; completed deposits are idempotent (`webhook_replay`). | same deposit webhook path |
| 4 | **KYC as a money gate.** Unverified users cannot initiate NGN/foreign deposits or other money-moving routes. | `src/middleware/kycMiddleware.ts` (`requireVerifiedUser`) |
| 5 | **Least-privilege admin.** Role checks plus a permission matrix (`kyc.approve`, `deposits.approve`, `security.view`, etc.). | `src/security/permissionMatrix.ts`, `src/middleware/permissionMiddleware.ts` |
| 6 | **Security intelligence.** Auth/RBAC/webhook/OTP events persisted, scored, and exposed to super-admins. | `src/services/securityEvent.service.ts`, `src/modules/security-intelligence/` |
| 7 | **Auth hardening (Aug 2026).** Helmet headers; auth/admin-login rate limits; account lockout after failed passwords; refresh tokens stored as SHA-256 hashes and **revoked on logout and password reset**. | `src/app.ts`, `src/middleware/rateLimiter.ts`, `src/services/loginLockout.service.ts`, `src/services/refreshToken.service.ts`, migration `1775260000000-AddAuthHardening.ts` |
| 8 | **Adversarial tests.** Dedicated suite proving the controls above. | `tests/security.test.ts` |

These are **implementation and design choices I owned on this codebase**, not generic framework defaults (JWT/bcrypt alone are not claimed as innovation).

---

## 4. Outcomes (measurable, non-fabricated)

**Automated verification (19 August 2026):** `npm test -- tests/security.test.ts` — **8 passed / 8 total**, including:

- missing and malformed Bearer tokens rejected  
- non-admin user denied `/admin/users` (403)  
- unverified KYC blocked from `POST /deposits/ngn/initiate` (403 `KYC_NOT_VERIFIED`)  
- webhook without `verif-hash` or with wrong hash: HTTP 200, **wallet remains 0.00**  
- amount mismatch: no credit; valid webhook then **replay does not double-credit** (balance stays `1000.00`)  
- logout revokes stored refresh token (subsequent `/auth/refresh-token` → 401)  
- repeated failed logins → `429 ACCOUNT_LOCKED`  
- weak passwords rejected at register  

**Production volume:** user GMV and live threat counts are **not published in this brief**. Controls are demonstrated in test and in operator APIs (`GET /admin/security/threat-metrics`, `GET /admin/security/events`, `GET /health`). Redacted operator screenshots may be attached as a **separate** evidence image if the endorsing body allows; they are not required to read this brief.

**Reliability/security subsystem (completed 14 June 2026):** heartbeats, anomaly detection, incident records, and security event APIs — see in-repo report `docs/RELIABILITY_SECURITY_REPORT.md` (supporting artefact, not this 3-page brief).

---

## 5. Dated source evidence (commit range)

Work is on repository **sf-api** (`main`). Representative commits **authored on this project**:

| Date | Hash | Subject (as recorded) |
|------|------|------------------------|
| 2026-03-17 | `ab3223a` | Initial commit |
| 2026-03-19 | `8108e44` | Critical withdrawal, admin, security features, exchange engine |
| 2026-03-26 | `2b4b13c` | Governance UX, email templates, granular API error codes |
| 2026-04-02 | `f830b66` | Completed backend logic |
| 2026-06-14 | `dfd1e11` / `f1a114e` | Anomaly detection engine / security-intelligence stack |

**August 2026 auth hardening** (Helmet, lockout, refresh-token store/revoke, `tests/security.test.ts`) is present in the working tree and migration `1775260000000-AddAuthHardening.ts`. At the date of this brief it should be committed so the hash can be added here; until then the migration filename and test file are the dated artefacts.

Full `git log` is available on request. This brief does not duplicate other optional-criterion documents.

---

## 6. What this contribution changed

| Before (risk) | After (control) |
|---------------|-----------------|
| Wallet updates could be ad hoc | Only `WalletService` + ledger insert in one transaction |
| Payment provider callbacks trusted by payload | Signature + amount/currency + replay checks |
| JWT accepted without account state | Live DB check: suspended/deleted users rejected |
| Admin routes coarse | Permission matrix; `security.view` is super-admin |
| Logout was client-side discard | Server-side refresh-token revocation |
| Failed logins unbounded | Lockout + security event `account_locked` |

---

**Declaration.** I confirm that the contributions listed above are my own technical work on Sabo Finance. Company commercial metrics not stated here are omitted because they are not independently citable in this document.

**Applicant signature:** ______________________ **Date:** 19 August 2026
