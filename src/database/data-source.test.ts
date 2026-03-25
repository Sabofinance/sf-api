import 'dotenv/config';

import { DataSource } from 'typeorm';

import { AdminLog } from './entities/AdminLog';
import { Beneficiary } from './entities/Beneficiary';
import { Bid } from './entities/Bid';
import { Deposit } from './entities/Deposit';
import { Dispute } from './entities/Dispute';
import { ExchangeRate } from './entities/ExchangeRate';
import { Kyc } from './entities/Kyc';
import { LedgerEntry } from './entities/LedgerEntry';
import { Sabit } from './entities/Sabit';
import { Trade } from './entities/Trade';
import { TradeRating } from './entities/TradeRating';
import { User } from './entities/User';
import { Wallet } from './entities/Wallet';
import { DataSource } from 'typeorm';

// Use the DATABASE_URL_TEST specifically for test environment.
// Fallback to local db string if env not provided but it really should be.
const dbUrl = process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@localhost:5432/sabo_test';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: dbUrl,
  logging: false,
  synchronize: false,
  entities: [User, Wallet, LedgerEntry, Deposit, ExchangeRate, Kyc, AdminLog, Beneficiary, Bid, Withdrawal, Sabit, Trade, Dispute, TradeRating],
  migrations: ['src/database/migrations/*.ts'],
  ssl: false,
});