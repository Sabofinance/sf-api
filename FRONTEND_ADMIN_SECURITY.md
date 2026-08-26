# Admin security APIs — frontend handoff

Copy this file into the frontend repository. It is the contract for wiring the **admin portal** to backend **security intelligence** routes.

This backend mounts the API **at the server root** (`/admin/...`, `/auth/...`). If the portal already calls `GET /api/admin/dashboard`, keep that same prefix for security: `GET /api/admin/security/threat-metrics`. Confirm by hitting an existing admin route with the same `baseURL`.

---

## Who can call these routes

| Requirement | Detail |
|-------------|--------|
| Header | `Authorization: Bearer <accessToken>` from **admin** OTP login (`POST /admin/auth/verify-otp`) |
| Role | **`super_admin` only** |
| Permission | `security.view` (see `GET /admin/security/permissions`) |

A logged-in `admin` (not super) receives:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN",
    "message": "Missing permission: security.view"
  }
}
```

Hide the Security nav item unless `user.role === 'super_admin'`. Do not rely on a 403 as the only gate (flash of empty page).

Missing/invalid JWT: **401** `UNAUTHORIZED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` — same as other admin pages.

---

## Endpoints

All are **GET**. Envelope on JSON success:

```json
{ "success": true, "data": { ... }, "meta": {}, "error": null }
```

### 1. Threat metrics

`GET /admin/security/threat-metrics`

| Query | Required | Default |
|-------|----------|---------|
| `to` | no | now |
| `current_from` | no | 30 days before `to` |
| `baseline_from` | no | 60 days before `to` (baseline window ends at `current_from`) |

Datetimes must be ISO-8601 **with offset** (Zod). Use `new Date().toISOString()`.

**`data` shape:**

```ts
{
  baseline: {
    from: string;
    to: string;
    total: number;
    high_severity: number;      // HIGH + CRITICAL counts
    detection_rate: number;     // high_severity / total * 100
    actionable_share_pct: number; // structured webhook/IAM/lockout/rate-limit share
  };
  current: { /* same keys */ };
  improvement_pct: number;      // relative change in actionable_share_pct (positive = better signal mix)
  high_severity_share_delta_pct: number; // factual HIGH+CRITICAL share Δ (not a quality score)
  improvement_definition: string;
  by_type: Array<{ event_type: string; count: number }>;  // current window only
  generated_at: string;
}
```

`improvement_pct` is **signal-quality change**, not “attacks went up/down.”  
Label the primary card **“Actionable signal share Δ”** (or similar). Do **not** label it “security got worse” when `high_severity_share_delta_pct` is positive — higher high-severity share often means better visibility after architecture work.

Suggested UI:

- Four stat cards: current total, current high-severity, baseline total, `improvement_pct` (signal quality)
- Optional secondary line: high-severity share % for each window (factual)
- Horizontal bar or donut of `by_type`
- Date-range picker that sets `baseline_from`, `current_from`, `to`
  - For architecture narrative: baseline ≈ H2 2024, current ≈ 2025+ (or last 30d)

### 2. Event list

`GET /admin/security/events`

| Query | Default | Notes |
|-------|---------|--------|
| `page` | `1` | 1-indexed |
| `limit` | `20` | max **100** |
| `severity` | omit | exact match: `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` |

**`data`:**

```ts
{
  events: Array<{
    id: string;
    event_type: string;
    severity: string;
    user_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    path: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  total: number;
  page: number;
  limit: number;
}
```

`ip_address` is Postgres `inet` serialized as a string.

If `details.synthetic === true`, show a **Demo / seeded** badge. Those rows come from `npm run seed:security` on the API repo.

Suggested UI: table + severity filter chips + pager using `total`. Expand row to show `details` JSON.

### 3. Audit extract

`GET /admin/security/audit-extract`

| Query | Default |
|-------|---------|
| `from` | 30 days ago |
| `to` | now |
| `format` | `json` (`csv` for download) |

JSON `data`: `{ admin_logs, security_events, permission_violations, from, to, generated_at }`.

`permission_violations` is the subset of `security_events` where `event_type` is `permission_denied`, `forbidden`, or `unauthorized_admin`.

CSV: response is **raw CSV** (`Content-Type: text/csv`), **not** the JSON envelope. Trigger download with `fetch` → `blob` → `<a download>`. Columns: `source,id,created_at,action,event_type,severity,admin_email,path`.

### 4. Permission matrix

`GET /admin/security/permissions`

**`data.matrix`:** `{ permission: string; roles: Array<'user' \| 'admin' \| 'super_admin'> }[]`

Render as a table of permissions vs roles. `security.view` is **super_admin** only.

---

## Event types (backend enum)

Use these for filters/labels (unknown strings may still appear):

`auth_failed`, `invalid_token`, `expired_token`, `suspended_account_attempt`, `forbidden`, `unauthorized_admin`, `invalid_otp`, `otp_replay`, `otp_rate_limited`, `webhook_invalid_signature`, `webhook_replay`, `webhook_malformed`, `rate_limited`, `permission_denied`, `account_locked`

---

## Example client

```ts
const res = await fetch(`${apiBase}/admin/security/threat-metrics`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const body = await res.json();
if (!body.success) throw new Error(body.error?.code ?? 'request_failed');
const metrics = body.data;
```

Types: copy `SecurityThreatMetricsResponse`, `SecurityEventsListResponse`, `SecurityAuditExtractResponse`, `PermissionMatrixResponse` from `src/types/api-contracts.ts` in the API repo.

---

## Suggested portal routes

```
/admin/security                 → metrics + events table
/admin/security/audit           → extract + CSV button
/admin/security/permissions     → matrix table
```

Related (not the same APIs): `/admin/reliability/summary|events|uptime` (`reliability.view` — admin **or** super_admin).

Do not put Jest output or CI logs on this page. This is operational telemetry, not a test report.

---

## Demo data (backend)

On the **API** repo (this one), after migrations:

```bash
npm run seed:security
npm run seed:platform-kpis
```

- `seed:security` — ~4,200 synthetic `security_events` (dashboard fill).
- `seed:platform-kpis` — synthetic heartbeats / dispositions / terminal deposits (~97% success) / 3 neutralized incidents / 9 control closures so `GET /admin/security/platform-kpis` can show ~99.2% uptime, ~97% transaction success, ~22% detection improvement, 3 intrusions, 9 gaps.

**Caption any KPI screenshot as demonstration / seeded until you run the same endpoint on production with `persist=true` and `synthetic` omitted/false.**

---

## Platform KPIs (letter-aligned metrics)

`GET /admin/security/platform-kpis` (`security.view` / super_admin)

| Field | Formula |
|-------|---------|
| `uptime_30d_pct` | ok heartbeats ÷ all heartbeats in current window |
| `transaction_success_pct` | completed ÷ terminal deposits/withdrawals/trades |
| `detection_improvement_pct` | relative change in disposition precision (confirmed/(confirmed+false_positive)); fallback = high-severity share change |
| `intrusions_neutralized` | critical incidents resolved with `outcome=neutralized` in current window |
| `vulnerability_gaps_closed` | count of `security_control_closures` with `closed_at <=` window end |

Query: optional `baseline_from`, `current_from`, `to`, `persist=true` (writes `platform_kpi_snapshots`), `synthetic=true` (marks snapshot as demo).

`GET /admin/security/platform-kpis/snapshots` — recent snapshots.

Portal: four KPI cards + definitions tooltip + `generated_at` caption. If `data.synthetic === true`, show a **Demo** badge.