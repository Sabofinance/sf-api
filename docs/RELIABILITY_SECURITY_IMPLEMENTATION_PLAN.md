# SABO Reliability & Security Intelligence — Implementation Plan

> Generated before implementation. See `RELIABILITY_SECURITY_REPORT.md` for post-implementation status.

## Existing Components Discovered

| Area | Existing Implementation | Location |
|------|------------------------|----------|
| Health check | Static `{ status: 'ok' }` | `src/app.ts` |
| FX sync | 15-min interval, console logging | `src/jobs/fx-rate-sync.worker.ts`, `fx-rate-sync.queue.ts` |
| Background jobs | pin/bid/deposit expiry | `src/jobs/*.ts` |
| RBAC | 3 roles, coarse middleware | `src/middleware/adminMiddleware.ts` |
| Auth | JWT + OTP, sliding refresh | `src/middleware/authMiddleware.ts`, `auth.controller.ts` |
| Rate limiting | OTP + admin invite only | `src/middleware/rateLimiter.ts` |
| Webhook validation | Flutterwave verif-hash + amount check | `FlutterwaveProvider.ts`, `deposits.controller.ts` |
| Admin audit | `admin_logs` table + list endpoint | `AdminLog` entity, `listAdminLogs` |
| Analytics | Impact + metrics (retrospective) | `admin.controller.ts` |
| Error handling | Central handler, console on 500 | `src/middleware/errorHandler.ts` |
| APM | None | — |
| Anomaly detection | None | — |
| Security events | None | — |

## New Modules Required

```
src/
  config/observability.ts
  config/sentry.ts
  security/permissionMatrix.ts
  utils/requestContext.ts
  utils/jobMonitor.ts
  database/entities/
    ReliabilityHeartbeat.ts
    ReliabilityEvent.ts
    SecurityEvent.ts
    IncidentEvent.ts
    ApiRequestMetric.ts
  services/
    reliability.service.ts
    anomaly-detector.service.ts
    securityEvent.service.ts
    threat-score.service.ts
    incident.service.ts
  middleware/
    permissionMiddleware.ts
    requestMetricsMiddleware.ts
  jobs/
    anomalyDetectionJob.ts
    apiMetricsFlushJob.ts
  modules/reliability/
    reliability.controller.ts
    reliability.routes.ts
  modules/security-intelligence/
    security.controller.ts
    security.routes.ts
    health.controller.ts
```

## Files To Modify

| File | Change |
|------|--------|
| `src/database/data-source.ts` | Register new entities |
| `src/database/data-source.test.ts` | Register new entities |
| `src/config/env.ts` | Sentry + observability env vars |
| `src/app.ts` | Request metrics middleware, deep health |
| `src/server.ts` | Sentry init, anomaly job, metrics flush |
| `src/middleware/authMiddleware.ts` | Security event logging |
| `src/middleware/adminMiddleware.ts` | Security event on forbidden |
| `src/middleware/errorHandler.ts` | Security + reliability events on spikes |
| `src/middleware/rateLimiter.ts` | Rate-limit security events |
| `src/jobs/fx-rate-sync.worker.ts` | Heartbeats + monitored execution |
| `src/jobs/pinExpiryJob.ts` | Monitored job wrapper |
| `src/jobs/bidExpiryJob.ts` | Monitored job wrapper |
| `src/jobs/depositExpiryJob.ts` | Monitored job wrapper |
| `src/modules/auth/auth.controller.ts` | Failed login/OTP events |
| `src/modules/deposits/deposits.controller.ts` | Webhook security events |
| `src/modules/admin/admin.routes.ts` | Permission matrix + sub-routers |
| `tests/all-endpoints.smoke.test.ts` | New endpoint coverage |
| `package.json` | `@sentry/node` (optional) |

## Database Migrations Required

Single migration `1775250000000-AddReliabilitySecurityIntelligence.ts`:

- `reliability_heartbeats`
- `reliability_events`
- `security_events`
- `incident_events`
- `api_request_metrics`
