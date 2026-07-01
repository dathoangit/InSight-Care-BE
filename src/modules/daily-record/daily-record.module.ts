import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BedEntity } from '../layout/entities/bed.entity';
import { UserEntity } from '../user/user.entity';
import { DailyRecordController } from './daily-record.controller';
import { DailyRecordService } from './daily-record.service';
import { DailyRecordLockCron } from './daily-record-lock.cron';
import { DailyRecordEntity } from './entities/daily-record.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyRecordEntity, BedEntity, UserEntity]),
  ],
  controllers: [DailyRecordController],
  providers: [DailyRecordService, DailyRecordLockCron],
  exports: [DailyRecordService],
})
export class DailyRecordModule {}
