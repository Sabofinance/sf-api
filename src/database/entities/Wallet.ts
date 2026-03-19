import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Currency } from '../../utils/enums';

import { User } from './User';

@Entity({ name: 'wallets' })
@Index(['user_id', 'currency'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: '0' })
  balance!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  locked_balance!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  escrow_balance!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}

