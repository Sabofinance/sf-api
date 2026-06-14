import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'reliability_heartbeats' })
export class ReliabilityHeartbeat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  component!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: string;

  @Column({ type: 'int', nullable: true })
  latency_ms!: number | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
