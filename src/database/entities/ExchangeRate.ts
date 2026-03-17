import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'exchange_rates' })
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  pair!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  rate!: string;

  @Column({ type: 'varchar', length: 64 })
  source!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}

