import { env } from '../../config/env';

/** Public API origin used in invite emails (Render URL in production). */
export function apiPublicBaseUrl(): string {
  return (env.API_BASE_URL ?? `http://localhost:${env.PORT ?? 3001}`).replace(/\/$/, '');
}

/** Portal origin for post-setup login redirect. */
export function portalPublicBaseUrl(): string {
  return (env.WEBSITE_URL ?? 'https://sabofinance.com').replace(/\/$/, '');
}

/**
 * Invite CTA for email.
 * Hosts a self-contained setup form on the API so invitees can finish
 * without waiting for a portal page to exist.
 */
export function adminInviteSetupPageUrl(token: string): string {
  return `${apiPublicBaseUrl()}/admin/invites/setup-page?token=${encodeURIComponent(token)}`;
}

/** Where to send the invitee after successful setup. */
export function adminPortalLoginUrl(): string {
  return `${portalPublicBaseUrl()}/dashboard/admin/login`;
}
