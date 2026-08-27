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

- Three–four stat cards: current total (optional prior as secondary), current high-severity, `improvement_pct` (signal quality Δ)
- Optional secondary line: high-severity share % for each window (factual) behind ⓘ
- Horizontal bar or donut of `by_type`
- Date-range picker that sets `baseline_from`, `current_from`, `to`
  - Default last 30d; custom ranges for historical views only

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
- `seed:platform-kpis` — synthetic heartbeats / terminal deposits (~97% success) / 3 neutralized incidents / 9 control closures so filtering **From 2025-01-01 → now** shows ~99.2% uptime, ~97% transaction success, ~22% Detection Δ (aligned with Signal Quality), 3 intrusions, 9 gaps.
- `seed:security` — event mix tuned so the same Jan 2025 → now window vs equal-length prior yields ~22% actionable-share Δ. Telemetry starts **2023-06-01**.

**Caption any KPI screenshot as demonstration / seeded until you run the same endpoint on production with `persist=true` and `synthetic` omitted/false.**

---

## Platform KPIs (letter-aligned metrics)

`GET /admin/security/platform-kpis` (`security.view` / super_admin)

| Field | Formula |
|-------|---------|
| `uptime_30d_pct` | ok heartbeats ÷ all heartbeats in current window (**`null` if no heartbeats** — do not show 100%) |
| `transaction_success_pct` | completed ÷ terminal deposits/withdrawals/trades (**`null` if no terminal txns**) |
| `detection_improvement_pct` | **Same value as** threat-metrics `improvement_pct` (actionable signal share Δ). `detection_method` is always `actionable_share`. |
| `intrusions_neutralized` | critical incidents resolved with `outcome=neutralized` in current window |
| `vulnerability_gaps_closed` | count of `security_control_closures` with `closed_at <=` window end (cumulative) |

Query: optional `baseline_from`, `current_from`, `to`, `persist=true` (writes `platform_kpi_snapshots`), `synthetic=true` (marks snapshot as demo).

Invalid ranges (`current_from >= to` or `baseline_from >= current_from`) return **400** `INVALID_DATE_RANGE`.

`GET /admin/security/platform-kpis/snapshots` — recent snapshots.

Portal: KPI cards + definitions tooltip + `generated_at` caption. If `data.synthetic === true`, show a **Demo** badge.

---

## Professional Security Overview UX (portal standard)

This page is an **ops dashboard**, not an evidence exhibit. Design for day-to-day admin use. Screenshots for any external process should come from normal filtering — not from labeled “before/after architecture” chrome.

### Product principle

| Do | Don’t |
|----|-------|
| One global date range at the top | “Pre vs post architecture” marketing toggles |
| Neutral metric labels | Long formula essays on every card |
| Current window as the default view | Hero “Before architecture / After architecture” badges |
| Quiet secondary history (snapshots) | Two DEMO rows presented as the main story |
| Short tooltips behind an info icon | Paragraphs of explanatory copy in the layout |

### Recommended page layout (top → bottom)

```
[ From datetime ] [ To datetime ]  [ Last 7d | 30d | 90d ]  [ Apply ]
────────────────────────────────────────────────────────────────────
Platform KPIs          (4–5 compact cards for the selected range)
Threat summary         (3–4 compact cards for selected range)
Events by type         (bar/list)
Security events        (filterable table)
────────────────────────────────────────────────────────────────────
KPI history (optional, collapsed or below fold)
```

### 1. Global date filter (drives everything)

One range controls **all** Overview panels.

| UI | Meaning | API wiring |
|----|---------|------------|
| **To** | End of current window | `to` |
| **From** | Start of current window | `current_from` for KPIs & threat “current”; also events `from` if supported |
| Baseline (implicit) | Same length as current, ending at From | `baseline_from = From - (To - From)` |

Default on load: **Last 30 days** (`current_from = now-30d`, `to = now`; omit params or compute explicitly).

Quick chips only: **7d / 30d / 90d** (and maybe custom).  
**No** chip named “Pre vs post architecture.”

**Validation (required):**

- Block Apply (and don’t call APIs) when `From >= To`.
- On **400** `INVALID_DATE_RANGE`, show a short inline error — do not render KPI cards as 100% / 0.
- If `uptime_30d_pct === null` or `transaction_success_pct === null`, display **—** (no data), never invent 100%.
- Current ops target for a healthy last-30d window is ~**99%** uptime — that comes from live/seeded heartbeats, not an empty-window default.

When the user wants an older picture (e.g. late 2024), they simply set From/To — same UI, same cards.

```ts
function onApply(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  const baselineFrom = new Date(from.getTime() - ms);

  const q = {
    baseline_from: baselineFrom.toISOString(),
    current_from: from.toISOString(),
    to: to.toISOString(),
  };

  // refetch in parallel
  fetchThreatMetrics(q);
  fetchPlatformKpis(q);          // GET /admin/security/platform-kpis
  fetchSecurityEvents({ ... });  // keep severity pager; optionally filter by created_at client-side if API lacks from/to
}
```

Backend still supports `preset=architecture_cutover` for API/testing — **do not surface that preset in the UI.**

### 2. Platform KPIs (selected range)

`GET /admin/security/platform-kpis?...`

| Card label | Field | Notes |
|------------|-------|-------|
| Uptime | `uptime_30d_pct` | Show **—** when `null`. Expect ~99% on last 30d with seeded/live heartbeats |
| Transaction success | `transaction_success_pct` | Show **—** when `null` |
| Detection Δ | `detection_improvement_pct` | **Same number as** Threat “Signal quality Δ”. Format with `+`/`−` and color like the threat card |
| Intrusions neutralized | `intrusions_neutralized` | |
| Gaps closed | `vulnerability_gaps_closed` | Cumulative to `To` — optional subtext “to date” once in Definitions, not on every card |

- One line of muted meta: `Generated {generated_at}`  
- Definitions: single **ⓘ** popover using `definitions` — not inline essays  
- If `synthetic === true`, a small muted “Demo data” note is enough (or omit on production screenshots by using non-synthetic persist later)

### 3. Threat summary (selected range)

`GET /admin/security/threat-metrics?...`

| Card label | Field |
|------------|-------|
| Events | `current.total` (optional muted secondary: prior `baseline.total`) |
| High-severity | `current.high_severity` |
| Signal quality Δ | `improvement_pct` — **must match** Platform KPI Detection Δ for the same range |

**Do not** show a standalone **Prior period events** card — it invites “volume Δ should equal quality Δ” confusion. Fold prior total into the Events card as a small secondary line if needed.

Keep subtext **one short line max**, e.g. one shared note under the row: “Deltas vs prior period of equal length.”  
Put long definitions only in ⓘ.

**Do not show by default:**

- `high_severity_share_delta_pct` as a big colored metric  
- Multi-line “visibility not quality” essays  
- Actionable/high-severity percentages under every card (optional behind ⓘ)

### 4. Events by type + event table

Unchanged functionally. Keep severity chips.  
DEMO/SEEDED badges: OK for internal ops; for clean screenshots prefer filtering to a window or accepting a few badges — don’t add more explanatory banners.

### 5. KPI history table (demote)

`GET /admin/security/platform-kpis/snapshots`

Treat as **history**, not the narrative centerpiece.

| Show | Hide |
|------|------|
| Period (`period_from` – `period_to`) | `era_label` / “Before architecture” / “After architecture” |
| Uptime, Tx success, Detection Δ, Intrusions, Gaps | Long DEMO callouts as primary affordance |
| Generated (secondary) | Architecture storytelling copy |

```ts
snapshots.map((s) => ({
  period: `${fmt(s.period_from)} – ${fmt(s.period_to)}`,
  uptime: Number(s.uptime_30d_pct),
  txSuccess: Number(s.transaction_success_pct),
  detectionDelta: Number(s.detection_improvement_pct), // column title: Detection Δ
  intrusions: Number(s.intrusions_neutralized),
  gaps: Number(s.vulnerability_gaps_closed),
}));
```

Prefer placing this in a **“History”** accordion or below the fold.

### 6. Remove from the UI

- Toggle: “Pre vs post architecture”  
- Subtitles like “Primary delta is actionable signal quality…” as permanent page chrome  
- Explicit before/after architecture labels on snapshot rows  
- Dense formula footnotes under every card  

### 7. Screenshot workflow (no special UI)

| Goal | Filter |
|------|--------|
| **After (agreed metrics)** | **From `01/01/2025` → To = now** — ~99% uptime, ~97% txn, ~22–25% Detection Δ, 3 intrusions, 9 gaps |
| **Before** | Any range **ending before 2025-01-01** (e.g. From `02/10/2024` → To `31/12/2024`) |
| Seed telemetry starts | **1 Jun 2023** (nothing meaningful before that) |

Same dashboard, different dates — that is what looks real. Default chips (7/30/90d) are fine for day-to-day ops; use the Jan 2025 → now range for the agreed after screenshot.

### 8. Frontend checklist

1. One global From/To (+ 7/30/90 chips) at top; refetch KPIs + threat + events together.  
2. **Reject `From >= To`** before calling APIs; handle 400 `INVALID_DATE_RANGE`.  
3. Delete architecture-named presets from the visible UI.  
4. Short labels; move explanations into ⓘ.  
5. Rename Detection → **Detection Δ**; format `+`/`−` like Signal quality Δ (same value).  
6. Drop standalone **Prior period events** card.  
7. Show **—** for null uptime / txn success (never fake 100% on empty windows).  
8. Snapshots: show **Period**, hide **era_label**.  
9. Demote snapshots / history; don’t lead the page with two DEMO rows.  
10. Keep default load = last 30 days; healthy current uptime target ≈ **99%**.
