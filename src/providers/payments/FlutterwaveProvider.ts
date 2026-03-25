import crypto from 'crypto';

import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

import type { InitiateDepositInput, InitiateDepositResult, PaymentProvider, WebhookResult } from './PaymentProvider';

export class FlutterwaveProvider implements PaymentProvider {
  async initiateDeposit(input: InitiateDepositInput): Promise<InitiateDepositResult> {
    if (!env.FLUTTERWAVE_SECRET) {
      throw new AppError('CONFIG_ERROR', 'FLUTTERWAVE_SECRET is required for NGN deposits', 500);
    }

    try {
      const response = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.FLUTTERWAVE_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: input.reference,
          amount: input.amount,
          currency: input.currency,
          redirect_url: 'http://localhost:5173/dashboard/deposits/callback',
          customer: {
            email: input.customerEmail,
          },
          customizations: {
            title: 'Sabo Finance Deposit',
            description: 'Wallet funding',
            logo: 'https://sabofinance.com/logo.png',
          },
        }),
      });

      const result = await response.json();

      if (!response.ok || result.status !== 'success') {
        throw new AppError('PAYMENT_PROVIDER_ERROR', result.message || 'Failed to initiate payment', 400);
      }

      return {
        provider: 'flutterwave',
        provider_reference: result.data.id,
        payment_link: result.data.link,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'An error occurred with Flutterwave', 500);
    }
  }

  async handleWebhook(rawBody: any, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult> {
    // Prefer live process.env so tests and webhooks can set the hash without reloading parsed env.
    const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH ?? env.FLUTTERWAVE_WEBHOOK_HASH;
    const received = headers['verif-hash'];
    const receivedVal = Array.isArray(received) ? received[0] : received;

    if (!expected) throw new AppError('CONFIG_ERROR', 'FLUTTERWAVE_WEBHOOK_HASH is required', 500);
    if (!receivedVal) throw new AppError('WEBHOOK_SIGNATURE_MISSING', 'Missing verif-hash', 400);
    const ok = crypto.timingSafeEqual(Buffer.from(receivedVal), Buffer.from(expected));
    if (!ok) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature', 400);

    return { handled: true };
  }

  async verifyTransaction(_providerReference: string): Promise<boolean> {
    // Phase 1: verification is performed by comparing webhook payload amount/currency to deposit record.
    return true;
  }

  async initiatePayout(): Promise<void> {
    throw new AppError('NOT_IMPLEMENTED', 'Payouts are out of Phase 1 scope', 400);
  }
}

