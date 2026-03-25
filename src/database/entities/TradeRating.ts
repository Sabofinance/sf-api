import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Trade } from './Trade';
import { User } from './User';

@Entity('trade_ratings')
export class TradeRating {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trade_id!: string;

  @ManyToOne(() => Trade)
  @JoinColumn({ name: 'trade_id' })
  trade!: Trade;

  @Column({ type: 'uuid' })
  rater_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rater_id' })
  rater!: User;

  @Column({ type: 'uuid' })
  rated_user_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rated_user_id' })
  rated_user!: User;

  @Column({ type: 'int' })
  score!: number; // e.g., 1 to 5

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}