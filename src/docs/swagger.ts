import swaggerJSDoc from 'swagger-jsdoc';

export function createSwaggerSpec() {
  const options: swaggerJSDoc.Options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Sabo Finance API',
        version: '1.0.0',
        description: 'P2P multi-currency exchange backend (Phase 1).',
      },
      servers: [
        {
          url: '/',
          description: 'Current server (same origin)',
        },
      ],
      tags: [
        { name: 'Auth' },
        { name: 'Wallets' },
        { name: 'Ledger' },
        { name: 'Deposits' },
        { name: 'KYC' },
        { name: 'Exchange Rates' },
        { name: 'Admin' },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
        schemas: {
          ApiSuccessEnvelope: {
            type: 'object',
            required: ['success', 'data', 'meta', 'error'],
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object' },
              meta: { type: 'object' },
              error: { type: 'null', example: null },
            },
          },
          ApiErrorEnvelope: {
            type: 'object',
            required: ['success', 'data', 'error'],
            properties: {
              success: { type: 'boolean', example: false },
              data: { type: 'null', example: null },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', example: 'VALIDATION_ERROR' },
                  message: { type: 'string', example: 'Human readable message' },
                },
              },
            },
          },
          Currency: {
            type: 'string',
            enum: ['NGN', 'GBP', 'USD', 'CAD'],
            example: 'NGN',
          },
          User: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              email_verified: { type: 'boolean' },
              phone_verified: { type: 'boolean' },
              kyc_status: { type: 'string', enum: ['unverified', 'pending', 'verified', 'rejected'] },
              is_suspended: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          Wallet: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              user_id: { type: 'string', format: 'uuid' },
              currency: { $ref: '#/components/schemas/Currency' },
              balance: { type: 'string', example: '0.00' },
              locked_balance: { type: 'string', example: '0.00' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
          LedgerEntry: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              reference: { type: 'string', example: 'DEP-2026-000001' },
              user_id: { type: 'string', format: 'uuid' },
              wallet_id: { type: 'string', format: 'uuid' },
              type: {
                type: 'string',
                enum: [
                  'deposit',
                  'withdrawal',
                  'trade_debit',
                  'trade_credit',
                  'escrow_hold',
                  'escrow_release',
                  'reversal',
                  'adjustment',
                ],
              },
              amount: { type: 'string', example: '1000.00' },
              currency: { $ref: '#/components/schemas/Currency' },
              balance_before: { type: 'string', example: '0.00' },
              balance_after: { type: 'string', example: '1000.00' },
              initiated_by: { type: 'string', format: 'uuid' },
              related_id: { type: 'string', format: 'uuid', nullable: true },
              status: { type: 'string', example: 'completed' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          Deposit: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              user_id: { type: 'string', format: 'uuid' },
              currency: { $ref: '#/components/schemas/Currency' },
              amount: { type: 'string', example: '5000.00' },
              provider: { type: 'string', example: 'flutterwave' },
              provider_reference: { type: 'string', nullable: true },
              proof_url: { type: 'string', nullable: true },
              status: {
                type: 'string',
                enum: ['initiated', 'pending_review', 'completed', 'failed', 'rejected'],
              },
              reviewed_by: { type: 'string', format: 'uuid', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          ExchangeRate: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              pair: { type: 'string', example: 'NGN/USD' },
              rate: { type: 'string', example: '0.001234' },
              source: { type: 'string', example: 'openexchangerates' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          Kyc: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              user_id: { type: 'string', format: 'uuid' },
              document_type: { type: 'string', example: 'passport' },
              document_url: { type: 'string' },
              selfie_url: { type: 'string' },
              status: { type: 'string', enum: ['unverified', 'pending', 'verified', 'rejected'] },
              rejection_reason: { type: 'string', nullable: true },
              reviewed_by: { type: 'string', format: 'uuid', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    apis: [
        'src/modules/auth/auth.controller.ts',
        'src/modules/deposits/deposits.controller.ts',
        'src/modules/exchange-rates/rates.controller.ts',
        'src/modules/kyc/kyc.controller.ts',
        'src/modules/ledger/ledger.controller.ts',
        'src/modules/wallets/wallets.controller.ts',
        'src/modules/admin/admin.controller.ts',
      ],
  };

  return swaggerJSDoc(options);
}

