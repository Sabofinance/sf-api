import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  FLUTTERWAVE_SECRET: z.string().min(1).optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().min(1).optional(),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().min(1).optional(),
  FX_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_URL: z.string().min(1).optional(),
  EMAIL_ENABLED: z.preprocess((v) => v === 'true', z.boolean()).default(false),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  API_BASE_URL: z.string().url().optional(),
  WEBSITE_URL: z.string().url().optional(),
  CONTACT_URL: z.string().url().optional(),
  HELP_CENTER_URL: z.string().url().optional(),
  SUPPORT_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

