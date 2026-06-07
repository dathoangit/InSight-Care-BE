import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { BedEntity } from '../../layout/entities/bed.entity';

@Entity({ name: 'daily_records' })
@Index(['date', 'bedId'], { unique: true })
export class DailyRecordEntity extends AbstractEntity {
  @Index()
  @Column({ type: 'date' })
  date!: string;

  @Index()
  @Column({ name: 'bed_id', type: 'uuid' })
  bedId!: Uuid;

  @Column({
    name: 'morning_patient_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  morningPatientName!: string | null;

  @Column({
    name: 'evening_patient_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  eveningPatientName!: string | null;

  @Column({ name: 'morning_pulse', type: 'int', nullable: true })
  morningPulse!: number | null;

  @Column({ name: 'morning_temp', type: 'float', nullable: true })
  morningTemp!: number | null;

  @Column({ name: 'morning_bp', type: 'varchar', length: 32, nullable: true })
  morningBp!: string | null;

  @Column({ name: 'evening_pulse', type: 'int', nullable: true })
  eveningPulse!: number | null;

  @Column({ name: 'evening_temp', type: 'float', nullable: true })
  eveningTemp!: number | null;

  @Column({ name: 'evening_bp', type: 'varchar', length: 32, nullable: true })
  eveningBp!: string | null;

  @Column({ name: 'is_locked', type: 'boolean', default: false })
  isLocked!: boolean;

  @ManyToOne(() => BedEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bed_id' })
  bed!: BedEntity;
}
