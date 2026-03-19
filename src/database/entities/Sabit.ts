import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Currency, SabitStatus, SabitType } from '../../utils/enums';

import { User } from './User';

@Entity({ name: 'sabits' })
@Index(['user_id'])
@Index(['status', 'currency'])
export class Sabit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'enum', enum: SabitType })
  type!: SabitType;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  available_amount!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  rate_ngn!: string;

  @Column({ type: 'jsonb', nullable: true })
  payment_methods!: unknown | null;

  @Column({ type: 'enum', enum: SabitStatus, default: SabitStatus.active })
  status!: SabitStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}