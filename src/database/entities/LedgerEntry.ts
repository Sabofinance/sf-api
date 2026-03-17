import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Currency, LedgerType } from '../../utils/enums';
import { User } from './User';
import { Wallet } from './Wallet';

@Entity({ name: 'ledger' })
@Index(['reference'], { unique: true })
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  reference!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  user!: User;

  @Column({ type: 'uuid' })
  wallet_id!: string;

  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  wallet!: Wallet;

  @Column({ type: 'enum', enum: LedgerType })
  type!: LedgerType;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  balance_before!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  balance_after!: string;

  @Column({ type: 'uuid' })
  initiated_by!: string;

  @Column({ type: 'uuid', nullable: true })
  related_id!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'completed' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

