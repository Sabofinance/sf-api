import { Router } from 'express';

import { accountRouter } from './modules/account/account.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { beneficiariesRouter } from './modules/beneficiaries/beneficiaries.routes';
import { bidsRouter } from './modules/bids/bids.routes';
import { conversionsRouter } from './modules/conversions/conversions.routes';
import { depositsRouter, webhooksRouter } from './modules/deposits/deposits.routes';
import { disputesRouter } from './modules/disputes/disputes.routes';
import { ratesRouter } from './modules/exchange-rates/rates.routes';
import { companyRatesRouter } from './modules/company-rates';
import { kycRouter } from './modules/kyc/kyc.routes';
import { ledgerRouter } from './modules/ledger/ledger.routes';
import { notificationsRouter } from './modules/notifications';
import { ratingsRouter } from './modules/ratings'
import { sabitsRouter } from './modules/sabits/sabits.routes';
import { tradesRouter } from './modules/trades/trades.routes';
import { walletsRouter } from './modules/wallets/wallets.routes';
import { withdrawalsRouter } from './modules/withdrawals/withdrawals.routes';


export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/account', accountRouter);
apiRouter.use('/deposits', depositsRouter);
apiRouter.use('/kyc', kycRouter);
apiRouter.use('/ledger', ledgerRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/company-rates', companyRatesRouter);
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
apiRouter.use('/ratings', ratingsRouter);
apiRouter.use('/bids', bidsRouter);

