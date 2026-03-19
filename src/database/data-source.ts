import { DataSource } from 'typeorm';

import { AdminLog } from './entities/AdminLog';
import { Beneficiary } from './entities/Beneficiary';
import { Deposit } from './entities/Deposit';
import { Dispute } from './entities/Dispute';
import { ExchangeRate } from './entities/ExchangeRate';
import { Kyc } from './entities/Kyc';
import { LedgerEntry } from './entities/LedgerEntry';
import { Sabit } from './entities/Sabit';
import { Trade } from './entities/Trade';
import { User } from './entities/User';
import { Wallet } from './entities/Wallet';
import { Withdrawal } from './entities/Withdrawal';

const isTest = process.env.NODE_ENV === 'test';
const databaseUrl = isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    isTest ? 'DATABASE_URL_TEST is required for testing' : 'DATABASE_URL is required'
  );
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  logging: process.env.NODE_ENV === 'development',
  synchronize: false,
  entities: [
    User, Wallet, LedgerEntry, Deposit, ExchangeRate,
    Kyc, AdminLog, Beneficiary, Withdrawal, Sabit, Trade, Dispute
  ],
  migrations: [
    process.env.NODE_ENV === 'production'
      ? 'dist/database/migrations/*.js'
      : 'src/database/migrations/*.ts'
  ],
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});