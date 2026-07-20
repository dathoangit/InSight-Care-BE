import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { BedEntity } from '../../layout/entities/bed.entity';
import { PatientEntity } from './patient.entity';
import {
  PatientAdmissionSource,
  PatientAdmissionStatus,
} from './patient.enums';

@Entity({ name: 'patient_admissions' })
@Index(['patientId', 'startDate'])
@Index(['bedId', 'status'])
@Index(['startDate', 'endDate'])
export class PatientAdmissionEntity extends AbstractEntity {
  @Column({ name: 'patient_id', type: 'uuid' })
  patientId!: Uuid;

  @Column({ name: 'bed_id', type: 'uuid' })
  bedId!: Uuid;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PatientAdmissionStatus,
    default: PatientAdmissionStatus.ACTIVE,
  })
  status!: PatientAdmissionStatus;

  @Column({
    name: 'source',
    type: 'enum',
    enum: PatientAdmissionSource,
  })
  source!: PatientAdmissionSource;

  @ManyToOne(() => PatientEntity, (patient) => patient.admissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'patient_id' })
  patient!: PatientEntity;

  @ManyToOne(() => BedEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bed_id' })
  bed!: BedEntity;
}
