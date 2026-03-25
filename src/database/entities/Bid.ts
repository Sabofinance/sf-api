import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BidStatus, Currency } from '../../utils/enums';

import { Sabit } from './Sabit';
import { User } from './User';

@Entity({ name: 'bids' })
@Index(['sabit_id'])
@Index(['buyer_id'])
@Index(['seller_id'])
@Index(['status'])
export class Bid {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  @Index({ unique: true })
  reference!: string;

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
  proposed_rate_ngn!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  original_rate_ngn!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  total_ngn_at_bid_rate!: string;

  @Column({ type: 'enum', enum: BidStatus, default: BidStatus.pending })
  status!: BidStatus;

  @Column({ type: 'boolean', default: false })
  buyer_pin_verified!: boolean;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  seller_responded_at?: Date;

  @Column({ type: 'text', nullable: true })
  rejection_reason?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
