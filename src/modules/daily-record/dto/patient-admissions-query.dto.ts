import { IsOptional, Matches, MaxLength } from 'class-validator';

export class PatientAdmissionsQueryDto {
  @IsOptional()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  patientCode?: string;

  @IsOptional()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  medicalRecordCode?: string;
}
