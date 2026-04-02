import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Currency, DepositStatus } from '../../utils/enums';
import { User } from './User';

@Entity({ name: 'deposits' })
export class Deposit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  reference!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  user!: User;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 64 })
  provider!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  provider_reference!: string | null;

  @Column({ type: 'text', nullable: true })
  proof_url!: string | null;

  @Column({ type: 'enum', enum: DepositStatus, default: DepositStatus.initiated })
  status!: DepositStatus;

  @Column({ type: 'text', nullable: true })
  rejection_reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

