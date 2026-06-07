import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BedEntity } from '../layout/entities/bed.entity';
import { DailyRecordController } from './daily-record.controller';
import { DailyRecordService } from './daily-record.service';
import { DailyRecordLockCron } from './daily-record-lock.cron';
import { DailyRecordEntity } from './entities/daily-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DailyRecordEntity, BedEntity])],
  controllers: [DailyRecordController],
  providers: [DailyRecordService, DailyRecordLockCron],
  exports: [DailyRecordService],
})
export class DailyRecordModule {}
