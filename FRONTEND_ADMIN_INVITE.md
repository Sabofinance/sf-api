# Admin invite → setup → login (portal handoff)

Backend now emails a **working setup page** on the API so invitees can finish without a portal route. Portal can still host its own page later.

## Happy path

1. Super admin: `POST /admin/invites` `{ "email": "new@example.com" }` (body is **email only**).
2. Invitee opens email → **Set up admin account** → API page  
   `GET /admin/invites/setup-page?token=...`
3. Form submits `POST /admin/invites/setup` with:

```json
{
  "token": "<from URL>",
  "name": "Jane Doe",
  "phone": "+2348000000000",
  "password": "Password123"
}
```

Password rules: min 8, uppercase, lowercase, digit. **Phone is required.**

4. Invitee logs in on the portal with **admin** auth (not consumer auth):
   - `POST /admin/auth/login` `{ email, password }` → OTP email
   - `POST /admin/auth/verify-otp` `{ email, otp }` → tokens

## Optional portal page

Route suggestion: `/dashboard/admin/invite/setup?token=...`

1. On load: `GET /admin/invites/accept?token=...` with `Accept: application/json`
   - `setupRequired: true` → show name / phone / password form
   - otherwise → “Invite accepted — go to login”
2. Submit → `POST /admin/invites/setup`
3. Redirect to admin login; show “check email for OTP”

Older email links to `/admin/invites/accept` that open in a browser are redirected to the setup page.

## Env (production)

| Var | Purpose |
|-----|---------|
| `API_BASE_URL` | Public API origin used in invite emails (e.g. Render URL) |
| `WEBSITE_URL` | Portal origin for post-setup login link (default `https://sabofinance.com`) |
| `EMAIL_ENABLED=true` | Actually send invite + OTP mail |
| SMTP / Resend | Working mail transport |

## Re-invite if stuck

Invites expire in **7 days** and are single-use. If setup never completed, create a **new** invite from the Admins screen. If the email already has a consumer account, opening accept upgrades them to `admin` — they skip setup and use their existing password with **admin** login + OTP.
