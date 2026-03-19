import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { DisputeStatus } from '../../utils/enums';

import { Trade } from './Trade';
import { User } from './User';

@Entity({ name: 'disputes' })
@Index(['trade_id'])
@Index(['status'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trade_id!: string;

  @ManyToOne(() => Trade, { onDelete: 'RESTRICT' })
  trade!: Trade;

  @Column({ type: 'uuid' })
  raised_by_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  raised_by!: User;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.open })
  status!: DisputeStatus;

  @Column({ type: 'uuid', nullable: true })
  resolved_by_id!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  resolved_by!: User | null;

  @Column({ type: 'text', nullable: true })
  resolution_notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at!: Date | null;
}