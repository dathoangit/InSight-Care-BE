import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { generateHash } from '../../common/utils';
import { StaffRole } from '../../constants';
import { BedEntity } from '../layout/entities/bed.entity';
import { RoomEntity } from '../layout/entities/room.entity';
import { UserEntity } from '../user/user.entity';
import { buildBedNames } from './bed-name.utils';
import { HOSPITAL_LAYOUT } from './constants/hospital-layout';

interface IRoomSeedSpec {
  floor: number;
  name: string;
  bedCount: number;
}

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepository: Repository<RoomEntity>,
    @InjectRepository(BedEntity)
    private readonly bedRepository: Repository<BedEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedHospitalLayout();
    await this.seedAdminUser();
  }

  private buildRoomSeedSpecs(): IRoomSeedSpec[] {
    const specs: IRoomSeedSpec[] = [];

    for (const floorLayout of HOSPITAL_LAYOUT) {
      const bedCountByRoom = new Map<string, number>();

      for (const roomName of floorLayout.rooms) {
        bedCountByRoom.set(roomName, (bedCountByRoom.get(roomName) ?? 0) + 1);
      }

      for (const [roomName, bedCount] of bedCountByRoom) {
        specs.push({
          floor: floorLayout.floor,
          name: roomName,
          bedCount,
        });
      }
    }

    return specs;
  }

  private async seedHospitalLayout(): Promise<void> {
    const roomCount = await this.roomRepository.count();

    if (roomCount > 0) {
      return;
    }

    const roomSpecs = this.buildRoomSeedSpecs();
    const savedRooms = await this.roomRepository.save(
      roomSpecs.map((spec) =>
        this.roomRepository.create({
          floor: spec.floor,
          name: spec.name,
        }),
      ),
    );

    const beds = savedRooms.flatMap((room, index) => {
      const bedCount = roomSpecs[index]?.bedCount ?? 0;
      const roomName = roomSpecs[index]?.name ?? '';
      const names = buildBedNames(roomName, bedCount);

      return names.map((name) =>
        this.bedRepository.create({
          roomId: room.id,
          name,
        }),
      );
    });

    await this.bedRepository.save(beds);
    this.logger.log(`Seeded hospital layout with ${beds.length} beds`);
  }

  private async seedAdminUser(): Promise<void> {
    const existingAdmin = await this.userRepository.findOne({
      where: { username: 'admin' },
    });

    if (existingAdmin) {
      return;
    }

    await this.userRepository.save(
      this.userRepository.create({
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: generateHash('0123456789'),
        role: StaffRole.ADMIN,
        isActive: true,
        emailVerifiedAt: null,
      }),
    );

    this.logger.log('Seeded default admin user (admin / 0123456789)');
  }
}
