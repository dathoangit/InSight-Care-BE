import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StatusQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  date?: string;
}
