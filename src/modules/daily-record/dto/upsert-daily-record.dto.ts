import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertDailyRecordDto {
  @IsUUID('4')
  bedId!: Uuid;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  morningPatientName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  morningPatientCode?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  morningMedicalRecordCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  eveningPatientName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  eveningPatientCode?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}$/)
  @MaxLength(10)
  eveningMedicalRecordCode?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  morningPulse?: number | null;

  @IsOptional()
  @IsNumber()
  morningTemp?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  morningBp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  morningNote?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  eveningPulse?: number | null;

  @IsOptional()
  @IsNumber()
  eveningTemp?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  eveningBp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  eveningNote?: string | null;
}
