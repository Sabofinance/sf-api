import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'security_control_closures' })
export class SecurityControlClosure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  control_key!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'varchar', length: 64 })
  category!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  evidence_ref!: string | null;

  @Column({ type: 'jsonb', default: {} })
  details!: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  closed_at!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
