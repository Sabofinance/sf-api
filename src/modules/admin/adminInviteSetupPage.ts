import type { Request, Response } from 'express';

import { AppError } from '../../utils/errors';

import { adminPortalLoginUrl, apiPublicBaseUrl } from './adminInviteLinks';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Self-contained HTML form for invited admins.
 * Works without a portal route: email links here, form POSTs to /admin/invites/setup.
 */
export async function adminInviteSetupPage(req: Request, res: Response) {
  const tokenRaw = req.query.token;
  const token = typeof tokenRaw === 'string' ? tokenRaw : '';
  if (!token) throw new AppError('INVITE_TOKEN_MISSING', 'Invite token is required', 400);

  const apiBase = apiPublicBaseUrl();
  const loginUrl = adminPortalLoginUrl();
  const safeLoginUrl = escapeHtml(loginUrl);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin account setup — Sabo Finance</title>
  <style>
    :root { color-scheme: light; }
    body { margin:0; font-family: Arial, Helvetica, sans-serif; background:#f5f7f3; color:#10212b; }
    .wrap { max-width: 480px; margin: 40px auto; padding: 0 16px; }
    .card { background:#fff; border:1px solid #e2e9da; border-radius:16px; overflow:hidden; }
    .head { background:linear-gradient(120deg,#0a1e28,#173746); color:#fff; padding:24px; border-bottom:4px solid #c8f032; }
    .head h1 { margin:0; font-size:22px; }
    .head p { margin:10px 0 0; opacity:.92; font-size:14px; line-height:1.5; }
    .body { padding:24px; }
    label { display:block; font-size:13px; font-weight:700; margin:0 0 6px; }
    input { width:100%; box-sizing:border-box; padding:12px 14px; border:1px solid #d5ddd0; border-radius:10px; font-size:15px; margin-bottom:14px; }
    button { width:100%; border:0; border-radius:12px; padding:14px; background:#0a1e28; color:#c8f032; font-weight:800; font-size:15px; cursor:pointer; }
    button:disabled { opacity:.6; cursor:not-allowed; }
    .hint { font-size:12px; color:#5c6b61; margin:0 0 16px; line-height:1.5; }
    .msg { display:none; margin-bottom:14px; padding:12px; border-radius:10px; font-size:14px; line-height:1.45; }
    .msg.err { display:block; background:#fdecea; border:1px solid #f5c2c0; color:#7a1f1f; }
    .msg.ok { display:block; background:#f4fbd7; border:1px solid #dff187; color:#3f533f; }
    .email { font-weight:700; color:#1e5d45; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <h1>Set up your admin account</h1>
        <p>Create your password, then sign in with OTP on the admin portal.</p>
      </div>
      <div class="body">
        <div id="msg" class="msg" role="status"></div>
        <p class="hint">Invite email: <span id="email" class="email">checking…</span></p>
        <form id="setupForm" hidden>
          <label for="name">Full name</label>
          <input id="name" name="name" autocomplete="name" required minlength="2" />
          <label for="phone">Phone</label>
          <input id="phone" name="phone" autocomplete="tel" required minlength="7" maxlength="32" placeholder="+234..." />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" />
          <p class="hint">At least 8 characters, with uppercase, lowercase, and a number.</p>
          <button type="submit" id="submitBtn">Create admin account</button>
        </form>
        <div id="done" hidden>
          <p class="hint">Account ready. Go to the admin portal and log in with your email and password. You will receive an OTP.</p>
          <a href="${safeLoginUrl}" style="display:inline-block;margin-top:8px;padding:12px 18px;background:#0a1e28;color:#c8f032;text-decoration:none;border-radius:12px;font-weight:800;">Open admin login</a>
        </div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var token = ${JSON.stringify(token)};
      var apiBase = ${JSON.stringify(apiBase)};
      var msg = document.getElementById('msg');
      var emailEl = document.getElementById('email');
      var form = document.getElementById('setupForm');
      var done = document.getElementById('done');
      var submitBtn = document.getElementById('submitBtn');

      function show(type, text) {
        msg.className = 'msg ' + type;
        msg.textContent = text;
      }

      function jsonOrThrow(res) {
        return res.json().then(function (body) {
          if (!res.ok || !body.success) {
            var err = (body && body.error && body.error.message) || ('Request failed (' + res.status + ')');
            throw new Error(err);
          }
          return body.data;
        });
      }

      fetch(apiBase + '/admin/invites/accept?token=' + encodeURIComponent(token), {
        headers: { 'Accept': 'application/json' }
      })
        .then(jsonOrThrow)
        .then(function (data) {
          if (data.setupRequired) {
            emailEl.textContent = data.invite && data.invite.email ? data.invite.email : 'invited email';
            form.hidden = false;
            return;
          }
          emailEl.textContent = 'ready';
          show('ok', data.message || 'Invite already accepted. You can log in.');
          done.hidden = false;
        })
        .catch(function (e) {
          emailEl.textContent = 'unavailable';
          show('err', e.message || 'Invite is invalid or expired.');
        });

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        submitBtn.disabled = true;
        show('ok', 'Creating your account…');
        fetch(apiBase + '/admin/invites/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            token: token,
            name: document.getElementById('name').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            password: document.getElementById('password').value
          })
        })
          .then(jsonOrThrow)
          .then(function (data) {
            form.hidden = true;
            done.hidden = false;
            show('ok', (data && data.message) || 'Admin account created. Log in with OTP next.');
          })
          .catch(function (e) {
            show('err', e.message || 'Setup failed.');
            submitBtn.disabled = false;
          });
      });
    })();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(html);
}
