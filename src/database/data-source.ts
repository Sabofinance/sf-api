import { DataSource } from 'typeorm';

import { AdminLog } from './entities/AdminLog';
import { Deposit } from './entities/Deposit';
import { ExchangeRate } from './entities/ExchangeRate';
import { Kyc } from './entities/Kyc';
import { LedgerEntry } from './entities/LedgerEntry';
import { User } from './entities/User';
import { Wallet } from './entities/Wallet';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  logging: process.env.NODE_ENV === 'development',
  synchronize: false,
  entities: [User, Wallet, LedgerEntry, Deposit, ExchangeRate, Kyc, AdminLog],
  migrations: ['src/database/migrations/*.ts'],
});

