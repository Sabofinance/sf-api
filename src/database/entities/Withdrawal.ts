import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Currency, WithdrawalStatus } from '../../utils/enums';

import { Beneficiary } from './Beneficiary';
import { User } from './User';

@Entity({ name: 'withdrawals' })
@Index(['user_id'])
@Index(['status'])
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  reference!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  user!: User;

  @Column({ type: 'uuid' })
  beneficiary_id!: string;

  @ManyToOne(() => Beneficiary, { onDelete: 'RESTRICT' })
  beneficiary!: Beneficiary;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'enum', enum: WithdrawalStatus, default: WithdrawalStatus.requested })
  status!: WithdrawalStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  provider_reference!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}