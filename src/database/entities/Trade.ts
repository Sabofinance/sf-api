import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Currency, TradeStatus } from '../../utils/enums';

import { Sabit } from './Sabit';
import { User } from './User';

@Entity({ name: 'trades' })
@Index(['sabit_id'])
@Index(['buyer_id'])
@Index(['seller_id'])
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sabit_id!: string;

  @ManyToOne(() => Sabit, { onDelete: 'RESTRICT' })
  sabit!: Sabit;

  @Column({ type: 'uuid' })
  buyer_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  buyer!: User;

  @Column({ type: 'uuid' })
  seller_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  seller!: User;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  rate_ngn!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total_ngn!: string;

  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.initiated })
  status!: TradeStatus;

  @Column({ type: 'varchar', length: 32, unique: true })
  reference!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at!: Date | null;
}