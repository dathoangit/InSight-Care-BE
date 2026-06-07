import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../decorators';
import {
  DailyRecordService,
  type IBedTodayStatusDto,
  type ITodayRecordDto,
} from './daily-record.service';
import { HistoryQueryDto } from './dto/history-query.dto';
import { UpsertDailyRecordDto } from './dto/upsert-daily-record.dto';

@ApiTags('records')
@Controller('records')
export class DailyRecordController {
  constructor(private readonly dailyRecordService: DailyRecordService) {}

  @Get('today-status')
  @Auth()
  @ApiOkResponse({ description: 'Today bed status for polling' })
  getTodayStatus(): Promise<IBedTodayStatusDto[]> {
    return this.dailyRecordService.getTodayStatus();
  }

  @Post('upsert')
  @Auth()
  @ApiOkResponse({ description: 'Upsert today daily record for a bed' })
  upsert(@Body() dto: UpsertDailyRecordDto): Promise<ITodayRecordDto> {
    return this.dailyRecordService.upsert(dto);
  }

  @Get('history')
  @Auth()
  @ApiOkResponse({ description: 'Historical daily records' })
  getHistory(@Query() query: HistoryQueryDto): Promise<ITodayRecordDto[]> {
    return this.dailyRecordService.getHistory(query);
  }
}
