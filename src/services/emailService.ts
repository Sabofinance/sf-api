import fs from 'fs/promises';
import path from 'path';

import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { env } from '../config/env';
import { AppError } from '../utils/errors';

const resend = new Resend(env.RESEND_API_KEY || 're_test_key_123');

const transporter = env.SMTP_HOST ? nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
}) : null;

interface EmailOptions {
  to: string | string[]; // support single or multiple recipients
  subject: string;
  text?: string; // optional if only html
  html?: string; // optional if only text
  template?: string;
  context?: Record<string, string>;
  // You can easily extend later: cc, bcc, attachments, replyTo, etc.
}

function buildSharedEmailContext(context?: Record<string, string>): Record<string, string> {
  const websiteUrl = env.WEBSITE_URL || 'https://sabofinance.com';
  return {
    websiteUrl,
    contactUrl: env.CONTACT_URL || `${websiteUrl}/contact`,
    helpCenterUrl: env.HELP_CENTER_URL || `${websiteUrl}/help`,
    supportEmail: env.SUPPORT_EMAIL || 'support@sabofinance.com',
    appName: 'Sabo Finance',
    ...context,
  };
}

function withStandardFooter(content: string, context: Record<string, string>): string {
  const footerMarkup = `
<div style="border-top:1px solid #e8eee2;padding:16px 28px;font-size:12px;color:#5c6b61;">
  <div style="font-weight:700;color:#10212b;margin-bottom:6px;">{{appName}}</div>
  <div style="margin-bottom:8px;">Need help? <a href="{{helpCenterUrl}}" style="color:#1e5d45;text-decoration:none;">Help Center</a> · <a href="{{contactUrl}}" style="color:#1e5d45;text-decoration:none;">Contact Us</a> · <a href="mailto:{{supportEmail}}" style="color:#1e5d45;text-decoration:none;">{{supportEmail}}</a></div>
  <div>Website: <a href="{{websiteUrl}}" style="color:#1e5d45;text-decoration:none;">{{websiteUrl}}</a></div>
</div>`;

  let normalized = content.replace(/Sabo Finance Security Mailer/g, '{{appName}} Security Mailer');
  // Remove legacy one-line footers so we do not stack two footers.
  normalized = normalized.replace(
    /<div[^>]*class="footer"[^>]*>\s*\{\{appName\}\}\s*Security Mailer\s*<\/div>/gi,
    '',
  );
  const hasRichFooter =
    normalized.includes('Need help?') &&
    (normalized.includes('{{helpCenterUrl}}') ||
      normalized.includes('{{contactUrl}}') ||
      normalized.includes('{{supportEmail}}'));
  if (!hasRichFooter) {
    normalized = normalized.includes('</body>')
      ? normalized.replace('</body>', `${footerMarkup}\n</body>`)
      : `${normalized}\n${footerMarkup}`;
  }

  Object.entries(context).forEach(([key, value]) => {
    normalized = normalized.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });
  return normalized;
}

export async function sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-console
    console.log(`[TEST MODE] Email suppressed: TO=${options.to}, SUBJECT=${options.subject}`);
    return { messageId: 'test-message-id-' + Date.now() };
  }

  let { html, text, template, context } = options;
  const sharedContext = buildSharedEmailContext(context);

  if (template) {
    // Determine the correct path based on whether we're running compiled code or ts-node
    const basePath = __dirname.includes('dist') 
      ? path.join(__dirname, '../../src/templates/emails') // If in dist/services, go up to root then src
      : path.join(__dirname, '../templates/emails'); // If in src/services
      
    // Better yet, use process.cwd() as a reliable base
    const cwdPath = path.join(process.cwd(), 'src/templates/emails', `${template}.html`);
    const fallbackPath = path.join(__dirname, '../templates/emails', `${template}.html`);
    
    try {
      let content = '';
      try {
        content = await fs.readFile(cwdPath, 'utf-8');
      } catch (e) {
        // Fallback to relative path if cwd doesn't work
        content = await fs.readFile(fallbackPath, 'utf-8');
      }
      
      html = withStandardFooter(content, sharedContext);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to load email template: ${template} at paths ${cwdPath} and ${fallbackPath}`, error);
      // Fallback to plain text if template fails
      html = `<p>Failed to load template ${template}. Please contact support.</p>`;
    }
  }

  if (!env.EMAIL_ENABLED) {
    // eslint-disable-next-line no-console
    console.log('\n--- EMAIL MOCK ---');
    // eslint-disable-next-line no-console
    console.log(`To: ${options.to}`);
    // eslint-disable-next-line no-console
    console.log(`Subject: ${options.subject}`);

    // Extract key data for a cleaner console view
    const keysToLog = ['otp', 'resetLink', 'verificationLink', 'acceptLink'];
    const found = keysToLog.filter((key) => sharedContext[key]);

    if (found.length > 0) {
      found.forEach((key) => {
        // eslint-disable-next-line no-console
        console.log(`${key.toUpperCase().replace('LINK', ' LINK')}: ${sharedContext[key]}`);
      });
    } else {
      // eslint-disable-next-line no-console
      console.log(`Template: ${template}`);
      // eslint-disable-next-line no-console
      console.log(`Content: ${text || 'Check templates'}`);
    }
    // eslint-disable-next-line no-console
    console.log('-------------------\n');
    return { messageId: 'mock-id-' + Date.now() };
  }

  try {
    const fromAddress = env.EMAIL_FROM_ADDRESS || env.SMTP_USER || 'noreply@sabofinance.com';
    const fromString = `${env.EMAIL_FROM_NAME || 'Sabo Finance'} <${fromAddress}>`;

    if (transporter) {
      const info = await transporter.sendMail({
        from: fromString,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: html || '',
        text: text || '',
      });
      // eslint-disable-next-line no-console
      console.log('Email sent successfully via SMTP - Message ID:', info.messageId);
      return { messageId: info.messageId };
    }

    if (env.RESEND_API_KEY) {
      const { data, error } = await resend.emails.send({
        from: fromString,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: html || '',
        text: text || '',
      });

      if (error) {
        throw new AppError('EMAIL_PROVIDER_ERROR', `Email provider rejected the message: ${error.message}`, 503);
      }

      // eslint-disable-next-line no-console
      console.log('Email sent successfully via Resend - Message ID:', data?.id);
      return { messageId: data?.id || 'sent' };
    }

    throw new AppError('EMAIL_NOT_CONFIGURED', 'Email is not configured for this environment (set SMTP or RESEND_API_KEY).', 503);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send email:', error);
    if (error instanceof AppError) throw error;
    throw new AppError('EMAIL_SEND_FAILED', `Email could not be sent: ${(error as Error).message}`, 503);
  }
}

