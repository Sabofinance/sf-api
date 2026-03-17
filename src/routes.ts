import { Router } from 'express';

import { adminRouter } from './modules/admin/admin.routes';
import { authRouter } from './modules/auth/auth.routes';
import { depositsRouter, webhooksRouter } from './modules/deposits/deposits.routes';
import { kycRouter } from './modules/kyc/kyc.routes';
import { ledgerRouter } from './modules/ledger/ledger.routes';
import { ratesRouter } from './modules/exchange-rates/rates.routes';
import { walletsRouter } from './modules/wallets/wallets.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/deposits', depositsRouter);
apiRouter.use('/kyc', kycRouter);
apiRouter.use('/ledger', ledgerRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/rates', ratesRouter);
apiRouter.use('/wallets', walletsRouter);
apiRouter.use('/webhooks', webhooksRouter);

