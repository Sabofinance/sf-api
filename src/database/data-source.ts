import { DataSource } from 'typeorm';

import { AdminLog } from './entities/AdminLog';
import { ApiRequestMetric } from './entities/ApiRequestMetric';
import { Beneficiary } from './entities/Beneficiary';
import { Bid } from './entities/Bid';
import { Deposit } from './entities/Deposit';
import { Dispute } from './entities/Dispute';
import { ExchangeRate } from './entities/ExchangeRate';
import { IncidentEvent } from './entities/IncidentEvent';
import { CompanyRate } from './entities/CompanyRate';
import { Kyc } from './entities/Kyc';
import { LedgerEntry } from './entities/LedgerEntry';
import { Notifications } from './entities/Notifications';
import { ReliabilityEvent } from './entities/ReliabilityEvent';
import { RefreshToken } from './entities/RefreshToken';
import { ReliabilityHeartbeat } from './entities/ReliabilityHeartbeat';
import { SecurityEvent } from './entities/SecurityEvent';
import { AdminInvite } from './entities/AdminInvite';
import { Sabit } from './entities/Sabit';
import { Trade } from './entities/Trade';
import { TradeRating } from './entities/TradeRating';
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
    User,
    Wallet,
    LedgerEntry,
    Deposit,
    ExchangeRate,
    CompanyRate,
    Kyc,
    AdminLog,
    AdminInvite,
    ApiRequestMetric,
    Beneficiary,
    Bid,
    Withdrawal,
    Sabit,
    Trade,
    Dispute,
    IncidentEvent,
    Notifications,
    ReliabilityEvent,
    RefreshToken,
    ReliabilityHeartbeat,
    SecurityEvent,
    TradeRating,
  ],
  migrations: [
    process.env.NODE_ENV === 'production'
      ? 'dist/database/migrations/*.js'
      : 'src/database/migrations/*.ts',
  ],
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});