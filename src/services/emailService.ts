import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

// ────────────────────────────────────────────────
// Helper: secure flag for common SMTP ports
// 465 → implicit TLS (secure: true)
// 587 → STARTTLS (secure: false)
// 25  → plain (avoid)
// others → false
// ────────────────────────────────────────────────
function getSecureFlag(port: number | string): boolean {
  const portNum = Number(port);
  return !isNaN(portNum) && portNum === 465;
}

// ────────────────────────────────────────────────
// Defaults & config check
// ────────────────────────────────────────────────
const smtpPort = Number(env.SMTP_PORT) || 587;
const isSmtpConfigured =
  env.EMAIL_ENABLED && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

let transporter: Transporter<SMTPPool.SentMessageInfo> | null = null;

// ────────────────────────────────────────────────
// Initialize transporter (only if fully configured)
// ────────────────────────────────────────────────
if (isSmtpConfigured) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: smtpPort,
    secure: getSecureFlag(smtpPort),

    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },

    // Pooling (performance + reliability)
    pool: true,
    maxMessages: 100,
    maxConnections: 5,
    rateDelta: 1000,

    // Prevent indefinite hangs (critical on some networks)
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,

    // Modern TLS (most servers require ≥ TLS 1.2 now)
    tls: {
      minVersion: 'TLSv1.2',
      // rejectUnauthorized: false,   // ← only temporarily for self-signed/internal servers
    },

    // Uncomment during debugging (very helpful)
    // logger: true,
    // debug: true,
  }) as Transporter<SMTPPool.SentMessageInfo>;

  // Verify at startup (logs once — doesn't crash app)
  (async () => {
    try {
      await transporter.verify();
      console.log(`SMTP ready → ${env.SMTP_HOST}:${smtpPort} (secure: ${getSecureFlag(smtpPort)})`);
    } catch (err: any) {
      console.error('SMTP verification failed:');
      console.error('   Error:', err.message || err);
      console.error('\nCommon causes:');
      console.error('  • Wrong port/secure combo (try 465 + secure:true)');
      console.error('  • Firewall / hosting blocks SMTP (common on Windows too)');
      console.error('  • Gmail needs App Password (not regular password)');
      console.error('  • Self-signed cert → temporarily disable rejectUnauthorized');
    }
  })();
} else if (env.EMAIL_ENABLED) {
  console.warn('EMAIL_ENABLED=true but SMTP config incomplete → emails will be logged only');
} else {
  console.log('EMAIL_ENABLED=false → all emails mocked to console');
}

// ────────────────────────────────────────────────
// Email options interface
// ────────────────────────────────────────────────
interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  template?: string;
  context?: Record<string, any>;
  cc?: string | string[];
  bcc?: string | string[];
  // attachments?: nodemailer.Attachment[];
}

// ────────────────────────────────────────────────
// Main send function
// ────────────────────────────────────────────────
export async function sendEmail(
  options: EmailOptions,
): Promise<{ messageId: string; sent: boolean }> {
  let { html, text, template, context } = options;

  // ── Render template if requested ─────────────────────────────
  if (template) {
    const templatePath = path.join(__dirname, '../templates/emails', `${template}.html`);

    try {
      let content = await fs.readFile(templatePath, 'utf-8');
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          content = content.replace(new RegExp(`{{${key}}}`, 'g'), String(value ?? ''));
        });
      }
      html = content;
    } catch (err) {
      console.error(`Template failed to load: ${template}`, err);
      html = html || '<p>Template could not be loaded.</p>';
    }
  }

  // ── Mock mode (no real transporter or emails disabled) ────────
  if (!transporter || !env.EMAIL_ENABLED) {
    console.log('\n╔════════════════════ EMAIL MOCK ════════════════════╗');
    console.log(`To:      ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
    console.log(`Subject: ${options.subject}`);

    if (options.cc)
      console.log(`CC:      ${Array.isArray(options.cc) ? options.cc.join(', ') : options.cc}`);
    if (options.bcc)
      console.log(`BCC:     ${Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc}`);

    if (context?.otp) console.log(`OTP:          ${context.otp}`);
    if (context?.resetLink) console.log(`Reset Link:   ${context.resetLink}`);
    if (context?.name) console.log(`For:          ${context.name}`);

    console.log(`\n${text || (html ? html.substring(0, 300) + '...' : '(no content)')} `);
    console.log('╚════════════════════════════════════════════════════╝\n');

    return { messageId: `mock-${Date.now()}`, sent: false };
  }

  // ── Real send ─────────────────────────────────────────────────
  try {
    const info = await transporter.sendMail({
      from: `"Sabo Finance" <${env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      text,
      html,
      cc: options.cc,
      bcc: options.bcc,
      // attachments: options.attachments,
    });

    console.log(`Email sent → ID: ${info.messageId}`);
    return { messageId: info.messageId, sent: true };
  } catch (err: any) {
    console.error('Failed to send email:');
    console.error('   To:', options.to);
    console.error('   Subject:', options.subject);
    console.error('   Error:', err.message || err);
    throw new Error(`Email sending failed: ${err.message || 'Unknown error'}`);
  }
}
