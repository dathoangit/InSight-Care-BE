import { Matches, MaxLength } from 'class-validator';

export class PatientAdmissionsQueryDto {
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  patientCode!: string;
}
