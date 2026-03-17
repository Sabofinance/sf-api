import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './User';

@Entity({ name: 'admin_logs' })
export class AdminLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admin_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  admin!: User;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 64 })
  target_type!: string;

  @Column({ type: 'uuid' })
  target_id!: string;

  @Column({ type: 'jsonb' })
  details!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

