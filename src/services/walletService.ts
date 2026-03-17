import Decimal from 'decimal.js';
import { QueryRunner } from 'typeorm';

import { Currency, LedgerType } from '../utils/enums';
import { AppError, NotFoundError } from '../utils/errors';
import { nextReference } from './referenceService';

type Money = string;

function asDecimal(v: Money) {
  return new Decimal(v);
}

function assertNonNegative(amount: Decimal, code: string) {
  if (amount.isNaN() || amount.lte(0)) throw new AppError(code, 'Amount must be greater than zero', 400);
}

export class WalletService {
  async credit(params: {
    queryRunner: QueryRunner;
    userId: string;
    currency: Currency;
    amount: Money;
    type: LedgerType;
    initiatedBy: string;
    relatedId?: string | null;
    reference?: string;
  }) {
    const { queryRunner, userId, currency } = params;
    const amount = asDecimal(params.amount);
    assertNonNegative(amount, 'INVALID_AMOUNT');

    const wallet = await this.getWalletForUpdate(queryRunner, userId, currency);
    const before = asDecimal(wallet.balance);
    const after = before.plus(amount);

    await queryRunner.query(`UPDATE "wallets" SET "balance" = $1, "updated_at" = now() WHERE "id" = $2`, [
      after.toFixed(2),
      wallet.id,
    ]);

    const reference =
      params.reference ??
      (params.type === LedgerType.deposit
        ? await nextReference(queryRunner, 'DEP')
        : await nextReference(queryRunner, 'TXN'));

    await queryRunner.query(
      `
      INSERT INTO "ledger" (
        "id","reference","user_id","wallet_id","type","amount","currency",
        "balance_before","balance_after","initiated_by","related_id","status","created_at"
      ) VALUES (
        gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed', now()
      )
    `,
      [
        reference,
        userId,
        wallet.id,
        params.type,
        amount.toFixed(2),
        currency,
        before.toFixed(2),
        after.toFixed(2),
        params.initiatedBy,
        params.relatedId ?? null,
      ],
    );

    return { walletId: wallet.id, balance_before: before.toFixed(2), balance_after: after.toFixed(2), reference };
  }

  async debit(params: {
    queryRunner: QueryRunner;
    userId: string;
    currency: Currency;
    amount: Money;
    type: LedgerType;
    initiatedBy: string;
    relatedId?: string | null;
    reference?: string;
  }) {
    const { queryRunner, userId, currency } = params;
    const amount = asDecimal(params.amount);
    assertNonNegative(amount, 'INVALID_AMOUNT');

    const wallet = await this.getWalletForUpdate(queryRunner, userId, currency);
    const before = asDecimal(wallet.balance);
    if (before.lt(amount)) throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient available balance', 400);
    const after = before.minus(amount);

    await queryRunner.query(`UPDATE "wallets" SET "balance" = $1, "updated_at" = now() WHERE "id" = $2`, [
      after.toFixed(2),
      wallet.id,
    ]);

    const reference = params.reference ?? (await nextReference(queryRunner, 'TXN'));

    await queryRunner.query(
      `
      INSERT INTO "ledger" (
        "id","reference","user_id","wallet_id","type","amount","currency",
        "balance_before","balance_after","initiated_by","related_id","status","created_at"
      ) VALUES (
        gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed', now()
      )
    `,
      [
        reference,
        userId,
        wallet.id,
        params.type,
        amount.toFixed(2),
        currency,
        before.toFixed(2),
        after.toFixed(2),
        params.initiatedBy,
        params.relatedId ?? null,
      ],
    );

    return { walletId: wallet.id, balance_before: before.toFixed(2), balance_after: after.toFixed(2), reference };
  }

  async lock(params: { queryRunner: QueryRunner; userId: string; currency: Currency; amount: Money }) {
    const amount = asDecimal(params.amount);
    assertNonNegative(amount, 'INVALID_AMOUNT');
    const wallet = await this.getWalletForUpdate(params.queryRunner, params.userId, params.currency);

    const available = asDecimal(wallet.balance);
    if (available.lt(amount)) throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient available balance', 400);

    const newAvailable = available.minus(amount);
    const newLocked = asDecimal(wallet.locked_balance).plus(amount);

    await params.queryRunner.query(
      `UPDATE "wallets" SET "balance" = $1, "locked_balance" = $2, "updated_at" = now() WHERE "id" = $3`,
      [newAvailable.toFixed(2), newLocked.toFixed(2), wallet.id],
    );
  }

  async unlock(params: { queryRunner: QueryRunner; userId: string; currency: Currency; amount: Money }) {
    const amount = asDecimal(params.amount);
    assertNonNegative(amount, 'INVALID_AMOUNT');
    const wallet = await this.getWalletForUpdate(params.queryRunner, params.userId, params.currency);

    const locked = asDecimal(wallet.locked_balance);
    if (locked.lt(amount)) throw new AppError('INSUFFICIENT_LOCKED', 'Insufficient locked balance', 400);

    const newLocked = locked.minus(amount);
    const newAvailable = asDecimal(wallet.balance).plus(amount);

    await params.queryRunner.query(
      `UPDATE "wallets" SET "balance" = $1, "locked_balance" = $2, "updated_at" = now() WHERE "id" = $3`,
      [newAvailable.toFixed(2), newLocked.toFixed(2), wallet.id],
    );
  }

  async transfer(params: {
    queryRunner: QueryRunner;
    fromUserId: string;
    toUserId: string;
    currency: Currency;
    amount: Money;
    initiatedBy: string;
    relatedId?: string | null;
  }) {
    const amount = asDecimal(params.amount);
    assertNonNegative(amount, 'INVALID_AMOUNT');

    const reference = await nextReference(params.queryRunner, 'TXN');
    await this.debit({
      queryRunner: params.queryRunner,
      userId: params.fromUserId,
      currency: params.currency,
      amount: amount.toFixed(2),
      type: LedgerType.trade_debit,
      initiatedBy: params.initiatedBy,
      relatedId: params.relatedId ?? null,
      reference,
    });
    await this.credit({
      queryRunner: params.queryRunner,
      userId: params.toUserId,
      currency: params.currency,
      amount: amount.toFixed(2),
      type: LedgerType.trade_credit,
      initiatedBy: params.initiatedBy,
      relatedId: params.relatedId ?? null,
      reference,
    });
    return reference;
  }

  private async getWalletForUpdate(queryRunner: QueryRunner, userId: string, currency: Currency) {
    const rows = (await queryRunner.query(
      `SELECT "id","balance","locked_balance" FROM "wallets" WHERE "user_id" = $1 AND "currency" = $2 FOR UPDATE`,
      [userId, currency],
    )) as Array<{ id: string; balance: string; locked_balance: string }>;
    const wallet = rows[0];
    if (!wallet) throw new NotFoundError('Wallet not found');
    return wallet;
  }
}

