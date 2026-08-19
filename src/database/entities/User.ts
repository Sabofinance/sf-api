import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { KycStatus, UserRole } from '../../utils/enums';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30 })
  username!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 ,nullable:true})
  phone?: string | null = null;

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

  @Column({ type: 'varchar', length: 64, nullable: true })
  otp_purpose?: string;

  @Column({ type: 'varchar', length: 320, nullable: true })
  otp_target_email?: string;

  @Column({ type: 'boolean', default: false })
  email_verified!: boolean;

  @Column({ type: 'boolean', default: false })
  phone_verified!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transaction_pin_hash?: string;

  @Column({ type: 'boolean', default: false })
  transaction_pin_set!: boolean;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.unverified })
  kyc_status!: KycStatus;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.user })
  role!: UserRole;

  @Column({ type: 'boolean', default: false })
  is_suspended!: boolean;

  @Column({ type: 'int', default: 0 })
  failed_login_attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at?: Date | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  profile_picture_url?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

