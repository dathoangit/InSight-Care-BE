import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { type UserDto } from './user.dto';

export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface IUsersListResponseDto {
  items: UserDto[];
  total: number;
  limit: number;
  offset: number;
}
