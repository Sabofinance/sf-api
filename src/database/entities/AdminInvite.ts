import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'admin_invites' })
export class AdminInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // SHA-256 hex of the invite token (single-use).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  token_hash!: string;

  @Column({ type: 'uuid' })
  inviter_id!: string;

  @Column({ type: 'varchar', length: 320 })
  invited_email!: string;

  @Column({ type: 'enum', enum: ['admin', 'super_admin'], default: 'admin' })
  granted_role!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumed_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  consumed_by?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

