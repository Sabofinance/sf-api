import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Currency } from '../../utils/enums';

import { User } from './User';

@Entity({ name: 'beneficiaries' })
@Index(['user_id'])
export class Beneficiary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'enum', enum: Currency })
  currency!: Currency;

  @Column({ type: 'varchar', length: 200 })
  bank_name!: string;

  @Column({ type: 'varchar', length: 200 })
  account_name!: string;

  @Column({ type: 'varchar', length: 32 })
  account_number!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  sort_code!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  iban!: string | null;

  @Column({ type: 'boolean', default: false })
  is_default!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}