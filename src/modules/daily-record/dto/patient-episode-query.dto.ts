import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PatientEpisodeQueryDto {
  @IsUUID('4')
  bedId!: Uuid;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  patientName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  patientCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  medicalRecordCode?: string;

  @IsDateString()
  anchorDate!: string;
}
