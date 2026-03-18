import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { KycStatus, UserRole } from '../../utils/enums';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_reset_token?: string;

  @Column({ type: 'timestamptz', nullable: true })
  password_reset_expires?: Date;

  @Column({ type: 'varchar', length: 6, nullable: true })
  otp?: string;

  @Column({ type: 'timestamptz', nullable: true })
  otp_expires?: Date;

  @Column({ type: 'boolean', default: false })
  email_verified!: boolean;

  @Column({ type: 'boolean', default: false })
  phone_verified!: boolean;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.unverified })
  kyc_status!: KycStatus;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.user })
  role!: UserRole;

  @Column({ type: 'boolean', default: false })
  is_suspended!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

