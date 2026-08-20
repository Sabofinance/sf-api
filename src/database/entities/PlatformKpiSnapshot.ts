import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'platform_kpi_snapshots' })
export class PlatformKpiSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'timestamptz' })
  period_from!: Date;

  @Column({ type: 'timestamptz' })
  period_to!: Date;

  @Column({ type: 'numeric', precision: 8, scale: 4 })
  uptime_30d_pct!: string;

  @Column({ type: 'numeric', precision: 8, scale: 4 })
  transaction_success_pct!: string;

  @Column({ type: 'numeric', precision: 8, scale: 4 })
  detection_improvement_pct!: string;

  @Column({ type: 'varchar', length: 64 })
  detection_method!: string;

  @Column({ type: 'int' })
  intrusions_neutralized!: number;

  @Column({ type: 'int' })
  vulnerability_gaps_closed!: number;

  @Column({ type: 'jsonb', default: {} })
  definitions!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  breakdown!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  synthetic!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  generated_at!: Date;
}
