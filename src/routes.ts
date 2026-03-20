import { Router } from 'express';

import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { beneficiariesRouter } from './modules/beneficiaries/beneficiaries.routes';
import { conversionsRouter } from './modules/conversions/conversions.routes';
import { depositsRouter, webhooksRouter } from './modules/deposits/deposits.routes';
import { disputesRouter } from './modules/disputes/disputes.routes';
import { ratesRouter } from './modules/exchange-rates/rates.routes';
import { kycRouter } from './modules/kyc/kyc.routes';
import { ledgerRouter } from './modules/ledger/ledger.routes';
import { sabitsRouter } from './modules/sabits/sabits.routes';
import { tradesRouter } from './modules/trades/trades.routes';
import { walletsRouter } from './modules/wallets/wallets.routes';
import { withdrawalsRouter } from './modules/withdrawals/withdrawals.routes';
import { notificationsRouter } from './modules/notifications';


export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/deposits', depositsRouter);
apiRouter.use('/kyc', kycRouter);
apiRouter.use('/ledger', ledgerRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/rates', ratesRouter);
apiRouter.use('/wallets', walletsRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/beneficiaries', beneficiariesRouter);
apiRouter.use('/withdrawals', withdrawalsRouter);
apiRouter.use('/sabits', sabitsRouter);
apiRouter.use('/trades', tradesRouter);
apiRouter.use('/conversions', conversionsRouter);
apiRouter.use('/disputes', disputesRouter);
apiRouter.use('/notifications', notificationsRouter);

