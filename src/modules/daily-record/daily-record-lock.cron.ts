import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DailyRecordService } from './daily-record.service';

@Injectable()
export class DailyRecordLockCron {
  private readonly logger = new Logger(DailyRecordLockCron.name);

  constructor(private readonly dailyRecordService: DailyRecordService) {}

  @Cron('59 59 23 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async lockTodayRecords(): Promise<void> {
    await this.dailyRecordService.lockTodayRecords();
    this.logger.log('Locked today daily records at end of day');
  }
}
