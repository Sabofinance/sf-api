export type InitiateDepositInput = {
  amount: string;
  currency: string;
  customerEmail: string;
  reference: string;
};

export type InitiateDepositResult = {
  provider: string;
  provider_reference?: string | null;
  payment_link?: string | null;
};

export type WebhookResult = {
  handled: boolean;
};

export interface PaymentProvider {
  initiateDeposit(input: InitiateDepositInput): Promise<InitiateDepositResult>;
  handleWebhook(rawBody: unknown, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult>;
  verifyTransaction(providerReference: string): Promise<boolean>;
  initiatePayout(): Promise<void>;
}

