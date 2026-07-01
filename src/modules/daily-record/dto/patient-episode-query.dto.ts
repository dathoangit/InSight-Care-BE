import {
  IsDateString,
  IsString,
  IsUUID,
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

  @IsDateString()
  anchorDate!: string;
}
