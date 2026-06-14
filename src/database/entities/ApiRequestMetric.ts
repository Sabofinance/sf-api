import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'api_request_metrics' })
export class ApiRequestMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 512 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 8 })
  method!: string;

  @Column({ type: 'int' })
  status_code!: number;

  @Column({ type: 'int' })
  response_time_ms!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
