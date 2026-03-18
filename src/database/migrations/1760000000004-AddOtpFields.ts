import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOtpFields1760000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'otp',
        type: 'varchar',
        length: '6',
        isNullable: true,
      }),
      new TableColumn({
        name: 'otp_expires',
        type: 'timestamptz',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('users', ['otp', 'otp_expires']);
  }
}