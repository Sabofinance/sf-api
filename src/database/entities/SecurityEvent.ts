import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './User';

@Entity({ name: 'security_events' })
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  event_type!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({ type: 'uuid', nullable: true })
  user_id!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  user!: User | null;

  @Column({ type: 'inet', nullable: true })
  ip_address!: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  path!: string | null;

  @Column({ type: 'jsonb', default: {} })
  details!: Record<string, unknown>;

  /** confirmed | false_positive | ignored — required for precision-based detection KPI */
  @Column({ type: 'varchar', length: 32, nullable: true })
  disposition!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
