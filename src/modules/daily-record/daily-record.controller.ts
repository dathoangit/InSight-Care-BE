import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Auth, AuthUser } from '../../decorators';
import { type IJwtAuthenticatedUser } from '../auth/types/jwt-authenticated-user.type';
import {
  DailyRecordService,
  type ITodayRecordDto,
} from './daily-record.service';
import { type IBedStatusResponseDto } from './dto/bed-status-response.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { PatientEpisodeQueryDto } from './dto/patient-episode-query.dto';
import { type IPatientEpisodeResponseDto } from './dto/patient-episode-response.dto';
import { StatusQueryDto } from './dto/status-query.dto';
import { UpsertDailyRecordDto } from './dto/upsert-daily-record.dto';

@ApiTags('records')
@Controller('records')
export class DailyRecordController {
  constructor(private readonly dailyRecordService: DailyRecordService) {}

  @Get('today-status')
  @Auth()
  @ApiOkResponse({ description: 'Bed status with server date metadata' })
  getTodayStatus(
    @Query() query: StatusQueryDto,
  ): Promise<IBedStatusResponseDto> {
    return this.dailyRecordService.getStatus(query.date);
  }

  @Post('upsert')
  @Auth()
  @ApiOkResponse({ description: 'Upsert today daily record for a bed' })
  upsert(
    @Body() dto: UpsertDailyRecordDto,
    @AuthUser() user: IJwtAuthenticatedUser,
  ): Promise<ITodayRecordDto> {
    return this.dailyRecordService.upsert(dto, user.id);
  }

  @Get('history')
  @Auth()
  @ApiOkResponse({ description: 'Historical daily records' })
  getHistory(@Query() query: HistoryQueryDto): Promise<ITodayRecordDto[]> {
    return this.dailyRecordService.getHistory(query);
  }

  @Get('patient-episode')
  @Auth()
  @ApiOkResponse({ description: 'Patient stay episode with vitals chart data' })
  getPatientEpisode(
    @Query() query: PatientEpisodeQueryDto,
  ): Promise<IPatientEpisodeResponseDto> {
    return this.dailyRecordService.getPatientEpisode(query);
  }
}
