import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { KycStatus } from '../../utils/enums';
import { User } from './User';

@Entity({ name: 'kyc' })
export class Kyc {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  document_type!: string;

  @Column({ type: 'text' })
  document_url!: string;

  @Column({ type: 'text' })
  selfie_url!: string;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.pending })
  status!: KycStatus;

  @Column({ type: 'text', nullable: true })
  rejection_reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

