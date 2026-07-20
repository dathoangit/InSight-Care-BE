import { Column, Entity, Index, OneToMany } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { PatientIdentityType } from './patient.enums';
import { PatientAdmissionEntity } from './patient-admission.entity';

@Entity({ name: 'patients' })
export class PatientEntity extends AbstractEntity {
  @Index({ unique: true, where: '"patient_code" IS NOT NULL' })
  @Column({ name: 'patient_code', type: 'varchar', length: 10, nullable: true })
  patientCode!: string | null;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  displayName!: string | null;

  @Column({
    name: 'identity_type',
    type: 'enum',
    enum: PatientIdentityType,
  })
  identityType!: PatientIdentityType;

  @OneToMany(() => PatientAdmissionEntity, (admission) => admission.patient)
  admissions?: PatientAdmissionEntity[];
}
