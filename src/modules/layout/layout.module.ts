import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BedEntity } from './entities/bed.entity';
import { RoomEntity } from './entities/room.entity';
import { LayoutController } from './layout.controller';
import { LayoutService } from './layout.service';

@Module({
  imports: [TypeOrmModule.forFeature([RoomEntity, BedEntity])],
  controllers: [LayoutController],
  providers: [LayoutService],
  exports: [LayoutService, TypeOrmModule],
})
export class LayoutModule {}
