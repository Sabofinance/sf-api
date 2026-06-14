import 'dotenv/config';

import { DataSource } from 'typeorm';

import { AdminInvite } from './entities/AdminInvite';
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
import { ReliabilityHeartbeat } from './entities/ReliabilityHeartbeat';
import { SecurityEvent } from './entities/SecurityEvent';
import { Sabit } from './entities/Sabit';
import { Trade } from './entities/Trade';
import { TradeRating } from './entities/TradeRating';
import { User } from './entities/User';
import { Wallet } from './entities/Wallet';
import { Withdrawal } from './entities/Withdrawal';

const dbUrl = process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@localhost:5432/sabo_test';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: dbUrl,
  logging: false,
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
    ReliabilityHeartbeat,
    SecurityEvent,
    TradeRating,
  ],
  migrations: ['src/database/migrations/*.ts'],
  ssl: false,
});
