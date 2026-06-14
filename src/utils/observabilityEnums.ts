export enum ReliabilityComponent {
  fx_engine = 'fx_engine',
  background_jobs = 'background_jobs',
  api = 'api',
  database = 'database',
  webhook = 'webhook',
}

export enum HeartbeatStatus {
  ok = 'ok',
  degraded = 'degraded',
  failed = 'failed',
}

export enum ReliabilitySeverity {
  info = 'info',
  warning = 'warning',
  critical = 'critical',
}

export enum ReliabilityEventType {
  fx_stale = 'fx_stale',
  fx_rate_spike = 'fx_rate_spike',
  fx_sync_failure = 'fx_sync_failure',
  job_failure = 'job_failure',
  job_missed = 'job_missed',
  job_slow = 'job_slow',
  transaction_failure_spike = 'transaction_failure_spike',
  api_error_spike = 'api_error_spike',
  api_latency = 'api_latency',
  database_unavailable = 'database_unavailable',
}

export enum SecurityEventType {
  auth_failed = 'auth_failed',
  invalid_token = 'invalid_token',
  expired_token = 'expired_token',
  suspended_account_attempt = 'suspended_account_attempt',
  forbidden = 'forbidden',
  unauthorized_admin = 'unauthorized_admin',
  invalid_otp = 'invalid_otp',
  otp_replay = 'otp_replay',
  otp_rate_limited = 'otp_rate_limited',
  webhook_invalid_signature = 'webhook_invalid_signature',
  webhook_replay = 'webhook_replay',
  webhook_malformed = 'webhook_malformed',
  rate_limited = 'rate_limited',
  permission_denied = 'permission_denied',
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum IncidentStatus {
  open = 'open',
  investigating = 'investigating',
  resolved = 'resolved',
}

export enum IncidentSource {
  fx_sync_consecutive_failure = 'fx_sync_consecutive_failure',
  database_unavailable = 'database_unavailable',
  api_error_spike = 'api_error_spike',
  security_critical_threat = 'security_critical_threat',
  heartbeat_missing = 'heartbeat_missing',
}

export type Permission =
  | 'kyc.approve'
  | 'deposits.approve'
  | 'withdrawals.approve'
  | 'disputes.resolve'
  | 'admins.invite'
  | 'admins.remove'
  | 'company_rates.manage'
  | 'analytics.view'
  | 'users.manage'
  | 'reliability.view'
  | 'security.view';
