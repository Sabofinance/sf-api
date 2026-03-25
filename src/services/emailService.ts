import fs from 'fs/promises';
import path from 'path';

import nodemailer from 'nodemailer';
import { Resend } from 'resend';

import { env } from '../config/env';

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

export async function sendEmail(options: EmailOptions): Promise<{ messageId: string }> {
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line no-console
    console.log(`[TEST MODE] Email suppressed: TO=${options.to}, SUBJECT=${options.subject}`);
    return { messageId: 'test-message-id-' + Date.now() };
  }

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
      // eslint-disable-next-line no-console
      console.error(`Failed to load email template: ${template}`, error);
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
    if (context && (context.otp || context.resetLink)) {
      // eslint-disable-next-line no-console
      if (context.otp) console.log(`OTP: ${context.otp}`);
      // eslint-disable-next-line no-console
      if (context.resetLink) console.log(`Reset Link: ${context.resetLink}`);
    } else {
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
        throw new Error(`Resend Email sending failed: ${error.message}`);
      }

      // eslint-disable-next-line no-console
      console.log('Email sent successfully via Resend - Message ID:', data?.id);
      return { messageId: data?.id || 'sent' };
    }

    throw new Error('No email provider configured (SMTP or Resend)');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to send email:', error);
    throw new Error(`Email sending failed: ${(error as Error).message}`);
  }
}

