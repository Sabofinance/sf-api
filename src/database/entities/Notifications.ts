import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { NotificationStatus, NotificationType } from '../../utils/enums';
import { User } from './User';

@Entity({ name: 'notifications' })
export class Notifications {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  user_id?: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  user?: User;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.info })
  type!: NotificationType;

  @Column({ type: 'enum', enum: NotificationStatus, default: NotificationStatus.unread })
  status!: NotificationStatus;

  @Column({ type: 'uuid', nullable: true })
  related_id?: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}