import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'reliability_events' })
export class ReliabilityEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({ type: 'varchar', length: 64 })
  event_type!: string;

  @Column({ type: 'varchar', length: 64 })
  component!: string;

  @Column({ type: 'jsonb', default: {} })
  details!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
