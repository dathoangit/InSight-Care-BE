import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BedEntity } from '../layout/entities/bed.entity';
import { RoomEntity } from '../layout/entities/room.entity';
import { UserEntity } from '../user/user.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([RoomEntity, BedEntity, UserEntity])],
  providers: [SeedService],
})
export class SeedModule {}
