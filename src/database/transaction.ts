import { AppDataSource } from './data-source';

export async function withTransaction<T>(fn: (queryRunner: import('typeorm').QueryRunner) => Promise<T>) {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    const result = await fn(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (e) {
    await queryRunner.rollbackTransaction();
    throw e;
  } finally {
    await queryRunner.release();
  }
}

