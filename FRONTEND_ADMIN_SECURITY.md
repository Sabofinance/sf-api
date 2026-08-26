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

---

## Frontend mapping (Security Overview) — copy into portal

Use this exact binding. The current portal bug is labeling `improvement_pct` as “Change in high-severity share” with the **old** formula text.

### A. Threat metrics cards

`GET /admin/security/threat-metrics` → `body.data`

| UI label (use this) | Bind to | Format | Notes |
|---------------------|---------|--------|-------|
| **Current total** | `data.current.total` | integer | |
| **Current high-severity** | `data.current.high_severity` | integer | HIGH + CRITICAL count |
| **Baseline total** | `data.baseline.total` | integer | |
| **Actionable signal share Δ** | `data.improvement_pct` | `+X.XX%` / `-X.XX%` | **Primary delta card.** Positive = better structured detection mix. Color: green if `>= 0`, amber/red only if `< 0`. |
| *(remove / do not use as primary)* | ~~Change in high-severity share~~ | — | **Do not** bind the primary card to high-severity share anymore. |

**Subtitle under the delta card** (replace the current formula line):

> Relative change in actionable-event share (webhook / IAM / lockout / rate-limit). Positive means a more structured detection mix — not “more attacks.”

Prefer `data.improvement_definition` when present:

```ts
const deltaHint =
  data.improvement_definition ??
  'Relative change in share of actionable event types. Positive = better signal mix.';
```

**Optional secondary facts** (small text under baseline/current totals, not a scary red hero metric):

| Optional label | Bind to |
|----------------|---------|
| Baseline high-severity share | `data.baseline.detection_rate` → `XX.XX%` |
| Current high-severity share | `data.current.detection_rate` → `XX.XX%` |
| Baseline actionable share | `data.baseline.actionable_share_pct` → `XX.XX%` |
| Current actionable share | `data.current.actionable_share_pct` → `XX.XX%` |

If you still want the old severity-share delta for power users, show it as muted meta only:

| Optional muted label | Bind to |
|----------------------|---------|
| High-severity share Δ (factual) | `data.high_severity_share_delta_pct` |

**Do not** put `high_severity_share_delta_pct` in the large orange/red card.

### B. Threat metrics date filter (architecture narrative)

Query params (ISO-8601 **with offset**, e.g. `.toISOString()`):

| Control | Query param |
|---------|-------------|
| Baseline start | `baseline_from` |
| Current start | `current_from` |
| Window end | `to` |

Baseline end is always `current_from` (server-side).

**Suggested presets** (keep the page looking like a normal ops dashboard):

| Preset name | `baseline_from` | `current_from` | `to` |
|-------------|-----------------|----------------|------|
| Last 30 days (default) | omit / 60d ago | omit / 30d ago | now |
| Pre vs post architecture | `2024-07-01T00:00:00.000Z` | `2025-01-01T00:00:00.000Z` | now |

Show the resolved windows from the response caption:

```ts
`Baseline ${fmt(data.baseline.from)} – ${fmt(data.baseline.to)} · Current ${fmt(data.current.from)} – ${fmt(data.current.to)}`
```

### C. Platform KPI cards

`GET /admin/security/platform-kpis` → `body.data`

| UI label | Bind to | Type |
|----------|---------|------|
| Uptime (30d) | `data.uptime_30d_pct` | number → `XX.XX%` |
| Transaction success | `data.transaction_success_pct` | number → `XX.XX%` |
| Detection improvement | `data.detection_improvement_pct` | number → `XX.XX%` |
| Intrusions neutralized | `data.intrusions_neutralized` | number |
| Gaps closed | `data.vulnerability_gaps_closed` | number |
| Generated | `data.generated_at` | datetime |
| Demo badge | `data.synthetic === true` | show “Demo” |

Definitions tooltip: `data.definitions` (object of metric → explanation string).

### D. KPI snapshots table

`GET /admin/security/platform-kpis/snapshots` → `body.data.snapshots[]`

| Column label | Bind to | Notes |
|--------------|---------|-------|
| **Era** (recommended) | `era_label` | `"Before architecture"` / `"After architecture"` (from API) |
| **Period** (add this) | `period_from` → `period_to` | **Required for before/after.** e.g. `2 Oct 2024 – 31 Dec 2024` vs `27 Jul 2026 – 26 Aug 2026` |
| Generated | `generated_at` | secondary / smaller text OK |
| Uptime (30d) | `uptime_30d_pct` | **number** (API coerces); format `%` |
| Tx success | `transaction_success_pct` | number → `%` |
| Detection | `detection_improvement_pct` | number → `%` |
| Intrusions | `intrusions_neutralized` | number |
| Gaps closed | `vulnerability_gaps_closed` | number |
| Demo | `synthetic === true` | badge |

API also returns `era`: `'pre_jan_2025' | 'post_jan_2025'`. Snapshots are ordered by `period_to` DESC.

### Architecture presets (backend-supported)

No need to hand-type dates. Call:

```
GET /admin/security/threat-metrics?preset=architecture_cutover
GET /admin/security/platform-kpis?preset=architecture_cutover
GET /admin/security/platform-kpis?preset=pre_architecture
```

| Preset | Windows |
|--------|---------|
| `architecture_cutover` | baseline from `2024-07-01`, current from `2025-01-01`, to now |
| `pre_architecture` | KPI window ending `2024-12-31` (before cutover) |

Portal: add a select **Last 30 days** | **Pre vs post architecture** that sets `preset=architecture_cutover` (and clears custom dates).

Optional era hint from period end:

```ts
// Prefer API fields when present:
const label = s.era_label ?? (new Date(s.period_to) < new Date('2025-01-01Z') ? 'Before architecture' : 'After architecture');
```

### E. Quick TypeScript extract

```ts
// Threat metrics — primary delta card
const signalShareDelta = data.improvement_pct; // Actionable signal share Δ
// NOT: data.high_severity_share_delta_pct  (do not use for the hero card)

// Snapshots — show period, not only generated_at
snapshots.map((s) => ({
  period: `${fmt(s.period_from)} – ${fmt(s.period_to)}`,
  generated: fmt(s.generated_at),
  uptime: Number(s.uptime_30d_pct),
  txSuccess: Number(s.transaction_success_pct),
  detection: Number(s.detection_improvement_pct),
  intrusions: Number(s.intrusions_neutralized),
  gaps: Number(s.vulnerability_gaps_closed),
  demo: Boolean(s.synthetic),
}));
```

### F. Checklist before assessor screenshots

1. Relabel hero delta → **Actionable signal share Δ** bound to `improvement_pct`.
2. Remove old “high-severity share” formula copy from that card.
3. Add **Period** column on snapshots (`period_from` / `period_to`).
4. For architecture story, use preset **Pre vs post architecture** (baseline mid-2024 → current from 2025-01-01).
5. Keep **Demo** badge when `synthetic === true` / `details.synthetic === true`.
