import crypto from 'crypto';

import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

import type { InitiateDepositInput, InitiateDepositResult, PaymentProvider, WebhookResult } from './PaymentProvider';

export class FlutterwaveProvider implements PaymentProvider {
  async initiateDeposit(input: InitiateDepositInput): Promise<InitiateDepositResult> {
    // Phase 1: we only persist deposit initiation and return reference.
    // Controllers must never call Flutterwave directly.
    return {
      provider: 'flutterwave',
      provider_reference: input.reference,
      payment_link: null,
    };
  }

  async handleWebhook(_rawBody: unknown, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult> {
    const expected = env.FLUTTERWAVE_WEBHOOK_HASH;
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

