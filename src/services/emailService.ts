import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';

// Helper to determine secure flag based on common SMTP ports
// 465 → implicit TLS (secure: true)
// 587 → STARTTLS (secure: false, upgrades later)
// 25  → usually plain (but avoid if possible)
// Everything else → assume false + explicit tls options if needed
function getSecureFlag(port: number | string): boolean {
  const portNum = Number(port);
  if (isNaN(portNum)) return false;
  return portNum === 465; // true only for 465, false for 587/25/others
}

const smtpPort = env.SMTP_PORT || 587; // fallback to most common secure submission port

const isSmtpConfigured = env.EMAIL_ENABLED && !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

if (isSmtpConfigured) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(smtpPort), // ensure it's a number
    secure: getSecureFlag(smtpPort), // true for 465, false otherwise

    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    // Good defaults for reliability
    pool: true, // reuse connections (great for multiple emails)
    maxMessages: 100, // prevent overload
    rateDelta: 1000, // 1 message/sec max (adjust as needed)
    // Add timeouts to prevent ETIMEDOUT from hanging the app
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  // Verify connection once at startup (optional but very useful)
  (async () => {
    try {
      await transporter?.verify();
      console.log('SMTP transporter is ready to send emails');
    } catch (error) {
      console.error('SMTP connection verification failed:', error);
      // In production: notify admin, don't crash the whole app
    }
  })();
} else if (env.EMAIL_ENABLED) {
  console.warn(
    'EMAIL_ENABLED is true, but SMTP configuration is missing (SMTP_HOST, SMTP_USER, SMTP_PASS). Emails will be logged to the console.',
  );
} else {
  console.log(
    'EMAIL_ENABLED is false. Emails will be logged to the console instead of being sent.',
  );
}

interface EmailOptions {
  to: string | string[]; // support single or multiple recipients
  subject: string;
  text?: string; // optional if only html
  html?: string; // optional if only text
  template?: string;
  context?: Record<string, string>;
  // You can easily extend later: cc, bcc, attachments, replyTo, etc.
}

export async function sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
  let { html, text, template, context } = options;

  if (template) {
    const templatePath = path.join(__dirname, '../templates/emails', `${template}.html`);
    try {
      let content = await fs.readFile(templatePath, 'utf-8');
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
        });
      }
      html = content;
    } catch (error) {
      console.error(`Failed to load email template: ${template}`, error);
    }
  }

  if (!transporter) {
    console.log('\n--- EMAIL MOCK ---');
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    
    // Extract key data for a cleaner console view
    if (context && (context.otp || context.resetLink)) {
      if (context.otp) console.log(`OTP: ${context.otp}`);
      if (context.resetLink) console.log(`Reset Link: ${context.resetLink}`);
    } else {
      console.log(`Content: ${text || 'Check templates'}`);
    }
    console.log('-------------------\n');
    return { messageId: 'mock-id-' + Date.now() };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Sabo Finance" <${env.SMTP_USER}>`, // consistent & safe
      ...options,
      html,
      text,
    });

    console.log('Email sent successfully - Message ID:', info.messageId);
    return { messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send email:', error);
    throw new Error(`Email sending failed: ${(error as Error).message}`);
  }
}
