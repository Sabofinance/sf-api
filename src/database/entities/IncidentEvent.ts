import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './User';

@Entity({ name: 'incident_events' })
export class IncidentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: string;

  @Column({ type: 'uuid', nullable: true })
  assigned_to!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  assignee!: User | null;

  @Column({ type: 'text', nullable: true })
  resolution_notes!: string | null;

  @Column({ type: 'jsonb', default: {} })
  details!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at!: Date | null;
}
