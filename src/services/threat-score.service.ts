import type { SecurityEventType } from '../utils/observabilityEnums';
import { SecuritySeverity } from '../utils/observabilityEnums';

const baseScores: Record<string, number> = {
  auth_failed: 30,
  invalid_token: 25,
  expired_token: 10,
  suspended_account_attempt: 40,
  forbidden: 35,
  unauthorized_admin: 50,
  invalid_otp: 35,
  otp_replay: 60,
  otp_rate_limited: 45,
  webhook_invalid_signature: 70,
  webhook_replay: 65,
  webhook_malformed: 40,
  rate_limited: 50,
  permission_denied: 45,
};

export function scoreSecurityEvent(
  eventType: SecurityEventType | string,
  context: { frequency?: number; isAdminRoute?: boolean; isRepeatOffender?: boolean },
): SecuritySeverity {
  let score = baseScores[eventType] ?? 20;

  if (context.frequency && context.frequency >= 5) score += 20;
  if (context.frequency && context.frequency >= 10) score += 20;
  if (context.isAdminRoute) score += 15;
  if (context.isRepeatOffender) score += 25;

  if (score >= 80) return SecuritySeverity.CRITICAL;
  if (score >= 60) return SecuritySeverity.HIGH;
  if (score >= 35) return SecuritySeverity.MEDIUM;
  return SecuritySeverity.LOW;
}

export function severityToNumeric(severity: SecuritySeverity | string): number {
  switch (severity) {
    case SecuritySeverity.CRITICAL:
      return 4;
    case SecuritySeverity.HIGH:
      return 3;
    case SecuritySeverity.MEDIUM:
      return 2;
    default:
      return 1;
  }
}
