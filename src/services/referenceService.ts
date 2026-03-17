import { QueryRunner } from 'typeorm';

import { AppError } from '../utils/errors';

type ReferenceScope = 'DEP' | 'TXN' | 'WDR';

export async function nextReference(queryRunner: QueryRunner, scope: ReferenceScope, now = new Date()) {
  const year = now.getUTCFullYear();
  const rows = (await queryRunner.query(
    `SELECT "seq" FROM "reference_sequences" WHERE "year" = $1 AND "scope" = $2 FOR UPDATE`,
    [year, scope],
  )) as Array<{ seq: number }>;

  let seq = rows[0]?.seq;
  if (seq === undefined) {
    await queryRunner.query(
      `INSERT INTO "reference_sequences" ("year","scope","seq") VALUES ($1,$2,0)`,
      [year, scope],
    );
    seq = 0;
  }

  const next = seq + 1;
  if (next > 999999) throw new AppError('REFERENCE_EXHAUSTED', 'Yearly reference sequence exhausted', 500);

  await queryRunner.query(
    `UPDATE "reference_sequences" SET "seq" = $3 WHERE "year" = $1 AND "scope" = $2`,
    [year, scope, next],
  );

  return `${scope}-${year}-${String(next).padStart(6, '0')}`;
}

