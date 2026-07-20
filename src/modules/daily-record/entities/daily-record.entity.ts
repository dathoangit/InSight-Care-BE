import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { BedEntity } from '../../layout/entities/bed.entity';
import { UserEntity } from '../../user/user.entity';
import { PatientAdmissionEntity } from './patient-admission.entity';

@Entity({ name: 'daily_records' })
@Index(['businessDayAt', 'bedId'], { unique: true })
export class DailyRecordEntity extends AbstractEntity {
  @Index()
  @Column({ name: 'business_day_at', type: 'timestamptz' })
  businessDayAt!: Date;

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

  @Index()
  @Column({
    name: 'morning_patient_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  morningPatientCode!: string | null;

  @Column({
    name: 'evening_patient_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  eveningPatientName!: string | null;

  @Index()
  @Column({
    name: 'evening_patient_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  eveningPatientCode!: string | null;

  @Index()
  @Column({
    name: 'morning_patient_admission_id',
    type: 'uuid',
    nullable: true,
  })
  morningPatientAdmissionId!: Uuid | null;

  @Index()
  @Column({
    name: 'evening_patient_admission_id',
    type: 'uuid',
    nullable: true,
  })
  eveningPatientAdmissionId!: Uuid | null;

  @Column({ name: 'morning_pulse', type: 'int', nullable: true })
  morningPulse!: number | null;

  @Column({ name: 'morning_temp', type: 'float', nullable: true })
  morningTemp!: number | null;

  @Column({ name: 'morning_bp', type: 'varchar', length: 32, nullable: true })
  morningBp!: string | null;

  @Column({
    name: 'morning_note',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  morningNote!: string | null;

  @Column({ name: 'evening_pulse', type: 'int', nullable: true })
  eveningPulse!: number | null;

  @Column({ name: 'evening_temp', type: 'float', nullable: true })
  eveningTemp!: number | null;

  @Column({ name: 'evening_bp', type: 'varchar', length: 32, nullable: true })
  eveningBp!: string | null;

  @Column({
    name: 'evening_note',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  eveningNote!: string | null;

  @Column({ name: 'is_locked', type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ name: 'morning_entered_by_user_id', type: 'uuid', nullable: true })
  morningEnteredByUserId!: Uuid | null;

  @Column({ name: 'evening_entered_by_user_id', type: 'uuid', nullable: true })
  eveningEnteredByUserId!: Uuid | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'morning_entered_by_user_id' })
  morningEnteredByUser?: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'evening_entered_by_user_id' })
  eveningEnteredByUser?: UserEntity | null;

  @ManyToOne(() => BedEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bed_id' })
  bed!: BedEntity;

  @ManyToOne(() => PatientAdmissionEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'morning_patient_admission_id' })
  morningPatientAdmission?: PatientAdmissionEntity | null;

  @ManyToOne(() => PatientAdmissionEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'evening_patient_admission_id' })
  eveningPatientAdmission?: PatientAdmissionEntity | null;
}
