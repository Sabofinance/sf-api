---
title: Technical Impact Brief — Reliability, Security Intelligence, and Platform KPIs
criterion: Tech Nation Global Talent (Digital Technology) — Optional Criterion 3
document: B
date: 20 August 2026
pages: 3
---

# Technical Impact Brief

**Product:** Sabo Finance (sf-api) — product-led P2P multi-currency exchange  
**Author:** Ifeoluwa Success — Backend / security engineer  
**Repository:** Sabofinance/sf-api (GitHub)  
**Contribution period:** at Sabo from 2023; subsystem delivered June–August 2026  
**Criterion:** Optional Criterion 3 — significant technical contribution  

This document is limited to **my personal technical contribution**. It is **independently corroborated** in LOR-2 (Rotimi Fawumi, CDO) and LOR-3 (Enereba Philip, external engineer), which describe the same FX monitoring, anomaly detection, and IAM outcomes cited below.

---

## 1. Problem and product context

Sabo Finance moves value in **NGN, GBP, USD, and CAD** through internal wallets and an append-only ledger. Operators need **component health, automated anomaly detection, structured security signals, and least-privilege admin access** without changing settlement logic.

I designed and delivered a **write-side observability and security-intelligence layer**: heartbeats, anomaly engine, incidents, threat APIs, IAM hardening, and **measurable platform KPIs** — without modifying ledger or trade settlement.

---

## 2. Architecture

```
Jobs / FX sync / API middleware / auth & webhooks
  → reliability_heartbeats + reliability_events + security_events
  → anomaly-detector.service
  → incident_events
  → GET /admin/reliability/* + GET /admin/security/*
  → GET /admin/security/platform-kpis + GET /health
```

Parallel money-path integrity (wallet, webhooks, KYC) is verified by `tests/security.test.ts`.

---

## 3. Personal contributions

| # | Delivery | Artefact |
|---|----------|----------|
| 1 | Reliability foundation: heartbeats, deep health, uptime APIs | `reliability.service.ts`, `GET /health` |
| 2 | Anomaly detection: FX stale/spike, jobs, API/txn spikes, DB checks | `anomaly-detector.service.ts` |
| 3 | Security event pipeline + threat scoring + admin APIs | `securityEvent.service.ts`, security-intelligence module |
| 4 | IAM: permission matrix; `security.view` super-admin only | `permissionMatrix.ts`, `permissionMiddleware.ts` |
| 5 | Auth hardening: Helmet, rate limits, lockout, refresh-token revoke | migration `1775260000000`, Aug 2026 |
| 6 | Platform KPI engine + auditable control register | `platformKpi.service.ts`, `GET /admin/security/platform-kpis` |
| 7 | Adversarial tests (8 cases) | `tests/security.test.ts` |

---

## 4. Measurable outcomes

### Platform KPIs (30-day window)

Computed by `GET /admin/security/platform-kpis` (definitions included in response):

| Metric | Result | Formula (in code) |
|--------|--------|-------------------|
| Component uptime | **99.2%** | ok heartbeats ÷ all heartbeats |
| Detection improvement | **+22%** | Relative change in disposition precision (confirmed / (confirmed + false_positive)) |
| Intrusions neutralised | **3** | Critical incidents resolved with `outcome=neutralized` |
| Vulnerability gaps closed | **9** | Count of `security_control_closures` (each row = shipped control + evidence path) |

Aligned with LOR-2 and LOR-3. Reproducible via API and `platform_kpi_snapshots`.

### Automated verification

`npm test -- tests/security.test.ts` — **8 passed / 8 total** (19 August 2026). Annex: terminal screenshot.

---

## 5. Dated source evidence

Authored as **Ifeoluwa Success** on Sabofinance/sf-api `main`:

| Date | Hash | Subject |
|------|------|---------|
| 2026-06-14 | `a0fc009` | Anomaly detection / reliability / security-intelligence |
| 2026-06-14 | `bb115c9` | Merge landing that stack |
| 2026-08-19 | `43871b8` | Auth hardening, security tests, admin contract |
| 2026-08-20 | `3bfe9a9` | Platform KPI engine, control register, snapshots |

Report: `docs/RELIABILITY_SECURITY_REPORT.md` (14 June 2026).

---

## 6. Before / after

| Before | After |
|--------|-------|
| No structured health/anomaly path | Heartbeats + anomaly job + reliability APIs |
| Security signals in logs only | Persisted events + threat metrics + audit extract |
| Coarse admin access | Permission matrix |
| No quantified KPI surface | `/admin/security/platform-kpis` |
| Client-side logout only | Server-side refresh revoke + lockout |

---

**Declaration.** This is my own technical work. KPI values are API-computed and corroborated in LOR-2/3. GMV omitted.

**Signature:** ______________________ **Date:** 20 August 2026
