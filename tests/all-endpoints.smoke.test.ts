import crypto from 'crypto';

import request from 'supertest';


import { withTransaction } from '../src/database/transaction';
import { Currency, DepositStatus, KycStatus, SabitType } from '../src/utils/enums';

import { app, makeAdmin, registerAndLogin, registerVerifiedUser, signAdminToken } from './helpers';

describe('All Endpoints Smoke', () => {
  it('covers all mounted endpoint groups', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);

    const reg = await request(app).post('/auth/register').send({
      name: 'Auth User',
      email: `auth_${Date.now()}@example.com`,
      phone: `+2348${Math.floor(Math.random() * 1e9)}`,
      password: 'Password123!',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user).toHaveProperty('username');

    const login = await request(app).post('/auth/login').send({
      email: reg.body.data.user.email,
      password: 'Password123!',
    });
    expect(login.status).toBe(200);

    const otpRow = await withTransaction(async (qr) => {
      const rows = (await qr.query(`SELECT "otp" FROM "users" WHERE "id" = $1 LIMIT 1`, [reg.body.data.user.id])) as Array<{
        otp: string | null;
      }>;
      return rows[0];
    });
    expect(otpRow.otp).toBeTruthy();

    const verifyOtp = await request(app).post('/auth/verify-otp').send({
      email: reg.body.data.user.email,
      otp: otpRow.otp,
    });
    expect(verifyOtp.status).toBe(200);

    const refresh = await request(app).post('/auth/refresh-token').send({
      refreshToken: reg.body.data.tokens.refreshToken,
    });
    expect(refresh.status).toBe(200);

    const logout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${verifyOtp.body.data.tokens.accessToken}`);
    expect(logout.status).toBe(200);

    const forgotUser = await registerAndLogin();
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(rawResetToken).digest('hex');
    await withTransaction(async (qr) => {
      await qr.query(
        `UPDATE "users" SET "password_reset_token" = $1, "password_reset_expires" = now() + interval '10 minutes' WHERE "id" = $2`,
        [hashed, forgotUser.userId],
      );
    });



    const reset = await request(app).post('/auth/reset-password').send({
      token: rawResetToken,
      password: 'NewPassword123!',
    });
    expect(reset.status).toBe(200);

    const verified = await registerVerifiedUser();

    const wallets = await request(app).get('/wallets').set('Authorization', `Bearer ${verified.accessToken}`);
    expect(wallets.status).toBe(200);

    const oneWallet = await request(app)
      .get('/wallets/NGN')
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(oneWallet.status).toBe(200);

    const rates = await request(app).get('/rates');
    expect(rates.status).toBe(200);

    const kycStatus = await request(app)
      .get('/kyc/status')
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(kycStatus.status).toBe(200);

    const kycUpload = await request(app)
      .post('/kyc/upload')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .field('document_type', 'passport');
    expect([400, 500]).toContain(kycUpload.status);

    const depInit = await request(app)
      .post('/deposits/ngn/initiate')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ amount: '1000.00', email: verified.email });
    if (depInit.status !== 201) console.error(depInit.body);
    expect(depInit.status).toBe(201);

    const depList = await request(app).get('/deposits').set('Authorization', `Bearer ${verified.accessToken}`);
    expect(depList.status).toBe(200);

    const depId = depInit.body.data.deposit.id as string;
    const depGet = await request(app)
      .get(`/deposits/${depId}`)
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(depGet.status).toBe(200);

    const depForeign = await request(app)
      .post('/deposits/foreign')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .field('currency', Currency.USD)
      .field('amount', '500.00');
    expect([400, 500]).toContain(depForeign.status);

    const webhook = await request(app).post('/webhooks/flutterwave').send({
      event: 'charge.completed',
      data: { tx_ref: depInit.body.data.deposit.reference, currency: Currency.NGN, amount: '1000.00', id: 'fw_smoke' },
    });
    expect(webhook.status).toBe(200);

    const beneficiary = await request(app)
      .post('/beneficiaries')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({
        currency: Currency.NGN,
        bank_name: 'GTBank',
        account_name: 'Test User',
        account_number: '0123456789',
      });
    expect(beneficiary.status).toBe(201);

    const beneficiaryList = await request(app)
      .get('/beneficiaries')
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(beneficiaryList.status).toBe(200);

    await withTransaction(async (qr) => {
      await qr.query(`UPDATE "wallets" SET "balance" = $1 WHERE "user_id" = $2 AND "currency" = $3`, [
        '20000.00',
        verified.userId,
        Currency.NGN,
      ]);
    });

    const withdrawalReq = await request(app)
      .post('/withdrawals/request')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ beneficiary_id: beneficiary.body.data.beneficiary.id, amount: '1000.00' });
    expect(withdrawalReq.status).toBe(201);

    const withdrawalList = await request(app)
      .get('/withdrawals')
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(withdrawalList.status).toBe(200);

    const withdrawalGet = await request(app)
      .get(`/withdrawals/${withdrawalReq.body.data.withdrawal.id}`)
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(withdrawalGet.status).toBe(200);

    const buyer = await registerVerifiedUser();

    // Set PIN for the buyer
    const setPinBuyer = await request(app)
      .post('/account/transaction-pin/set')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ pin: '123456', confirm_pin: '123456' });
    expect(setPinBuyer.status).toBe(200);

    // Set PIN for the seller
    const setPinSeller = await request(app)
      .post('/account/transaction-pin/set')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ pin: '654321', confirm_pin: '654321' });
    expect(setPinSeller.status).toBe(200);

    await withTransaction(async (qr) => {
      await qr.query(`UPDATE "wallets" SET "balance" = $1 WHERE "user_id" = $2 AND "currency" = $3`, [
        '100.00',
        verified.userId,
        Currency.USD,
      ]);
      await qr.query(`UPDATE "wallets" SET "balance" = $1 WHERE "user_id" = $2 AND "currency" = $3`, [
        '300000.00',
        buyer.userId,
        Currency.NGN,
      ]);
    });

    const sabitCreate = await request(app)
      .post('/sabits')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ type: SabitType.SELL, currency: Currency.USD, amount: '50.00', rate_ngn: '1500.00' });
    expect(sabitCreate.status).toBe(201);

    const sabitsList = await request(app).get('/sabits');
    expect(sabitsList.status).toBe(200);

    const sabitId = sabitCreate.body.data.sabit.id as string;
    const sabitGet = await request(app).get(`/sabits/${sabitId}`);
    expect(sabitGet.status).toBe(200);

    // --- PHASE 3: BIDS ---
    const bidPlace = await request(app)
      .post('/bids')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        sabit_id: sabitId,
        amount: '20.00',
        proposed_rate_ngn: '1450.00',
        pin: '123456',
      });
    expect(bidPlace.status).toBe(201);
    const bidId = bidPlace.body.data.bid.id;

    const bidAccept = await request(app)
      .put(`/bids/${bidId}/accept`)
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ pin: '654321' });
    expect(bidAccept.status).toBe(200);

    const getMineBids = await request(app).get('/bids/mine').set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(getMineBids.status).toBe(200);

    const getReceivedBids = await request(app).get('/bids/received').set('Authorization', `Bearer ${verified.accessToken}`);
    expect(getReceivedBids.status).toBe(200);

    const tradeInit = await request(app)
      .post('/trades/initiate')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sabit_id: sabitId, amount: '20.00', pin: '123456' });
    expect(tradeInit.status).toBe(201);

    const tradeId = tradeInit.body.data.trade.id as string;

    const tradeSellerConfirm = await request(app)
      .put(`/trades/${tradeId}/seller-confirm`)
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ pin: '654321' });
    expect(tradeSellerConfirm.status).toBe(200);

    const tradeConfirm = await request(app)
      .post(`/trades/${tradeId}/confirm`)
      .set('Authorization', `Bearer ${verified.accessToken}`);
    expect(tradeConfirm.status).toBe(200);

    const disputeRaise = await request(app)
      .post('/disputes/raise')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ trade_id: tradeId, reason: 'Seller stopped responding after funds should have been released.' });
    expect(disputeRaise.status).toBe(201);

    const disputeList = await request(app).get('/disputes').set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(disputeList.status).toBe(200);

    const disputeGet = await request(app)
      .get(`/disputes/${disputeRaise.body.data.dispute.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(disputeGet.status).toBe(200);

    const quote = await request(app)
      .post('/conversions/quote')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ from: Currency.USD, to: Currency.NGN, amount: '2.00' });
    expect(quote.status).toBe(200);

    const convert = await request(app)
      .post('/conversions/execute')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({ from: Currency.USD, to: Currency.NGN, amount: '1.00' });
    expect(convert.status).toBe(201);

    const depForAdmin = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        `INSERT INTO "deposits" ("id","reference","user_id","currency","amount","provider","provider_reference","proof_url","status","reviewed_by","created_at")
         VALUES (gen_random_uuid(), 'DEP-2026-999999', $1, $2, $3, 'manual', NULL, NULL, $4, NULL, now())
         RETURNING *`,
        [buyer.userId, Currency.USD, '100.00', DepositStatus.pending_review],
      )) as Array<{ id: string }>;
      return rows[0];
    });

    const kycRow = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        `INSERT INTO "kyc" ("id","user_id","document_type","document_url","selfie_url","status","rejection_reason","reviewed_by","created_at")
         VALUES (gen_random_uuid(), $1, 'passport', 'https://example.com/doc.jpg', 'https://example.com/selfie.jpg', $2, NULL, NULL, now())
         RETURNING *`,
        [buyer.userId, KycStatus.pending],
      )) as Array<{ id: string }>;
      return rows[0];
    });

    const adminUser = await registerVerifiedUser();
    await makeAdmin(adminUser.userId);
    const adminToken = signAdminToken(adminUser.userId, adminUser.name, adminUser.email);

    const adminUsers = await request(app).get('/admin/users').set('Authorization', `Bearer ${adminToken}`);
    expect(adminUsers.status).toBe(200);

    const adminUserGet = await request(app).get(`/admin/users/${buyer.userId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(adminUserGet.status).toBe(200);

    const adminSuspend = await request(app)
      .post(`/admin/users/${buyer.userId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminSuspend.status).toBe(200);

    const adminReinstate = await request(app)
      .post(`/admin/users/${buyer.userId}/reinstate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminReinstate.status).toBe(200);

    const adminKycList = await request(app).get('/admin/kyc').set('Authorization', `Bearer ${adminToken}`);
    expect(adminKycList.status).toBe(200);

    const adminKycApprove = await request(app)
      .post(`/admin/kyc/${kycRow.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminKycApprove.status).toBe(200);

    const kycRow2 = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        `INSERT INTO "kyc" ("id","user_id","document_type","document_url","selfie_url","status","rejection_reason","reviewed_by","created_at")
         VALUES (gen_random_uuid(), $1, 'id-card', 'https://example.com/doc2.jpg', 'https://example.com/selfie2.jpg', $2, NULL, NULL, now())
         RETURNING *`,
        [buyer.userId, KycStatus.pending],
      )) as Array<{ id: string }>;
      return rows[0];
    });

    const adminKycReject = await request(app)
      .post(`/admin/kyc/${kycRow2.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Document is unclear and details are not readable.' });
    expect(adminKycReject.status).toBe(200);

    const adminDepApprove = await request(app)
      .post(`/admin/deposits/${depForAdmin.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminDepApprove.status).toBe(200);

    const depForAdmin2 = await withTransaction(async (qr) => {
      const rows = (await qr.query(
        `INSERT INTO "deposits" ("id","reference","user_id","currency","amount","provider","provider_reference","proof_url","status","reviewed_by","created_at")
         VALUES (gen_random_uuid(), 'DEP-2026-999998', $1, $2, $3, 'manual', NULL, NULL, $4, NULL, now())
         RETURNING *`,
        [buyer.userId, Currency.GBP, '80.00', DepositStatus.pending_review],
      )) as Array<{ id: string }>;
      return rows[0];
    });

    const adminDepReject = await request(app)
      .post(`/admin/deposits/${depForAdmin2.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminDepReject.status).toBe(200);
  });
});