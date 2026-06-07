import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BedEntity } from './entities/bed.entity';
import { RoomEntity } from './entities/room.entity';

export interface ILayoutBedDto {
  id: Uuid;
  name: string;
}

export interface ILayoutRoomDto {
  id: Uuid;
  name: string;
  beds: ILayoutBedDto[];
}

export interface ILayoutFloorDto {
  floor: number;
  rooms: ILayoutRoomDto[];
}

@Injectable()
export class LayoutService {
  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepository: Repository<RoomEntity>,
    @InjectRepository(BedEntity)
    private readonly bedRepository: Repository<BedEntity>,
  ) {}

  async getLayout(): Promise<ILayoutFloorDto[]> {
    const rooms = await this.roomRepository.find({
      order: { floor: 'ASC', name: 'ASC' },
    });
    const beds = await this.bedRepository.find({
      order: { name: 'ASC' },
    });

    const bedsByRoomId = new Map<Uuid, BedEntity[]>();

    for (const bed of beds) {
      const roomBeds = bedsByRoomId.get(bed.roomId) ?? [];
      roomBeds.push(bed);
      bedsByRoomId.set(bed.roomId, roomBeds);
    }

    const floors = new Map<number, ILayoutFloorDto>();

    for (const room of rooms) {
      const floorEntry = floors.get(room.floor) ?? {
        floor: room.floor,
        rooms: [],
      };

      floorEntry.rooms.push({
        id: room.id,
        name: room.name,
        beds: (bedsByRoomId.get(room.id) ?? []).map((bed) => ({
          id: bed.id,
          name: bed.name,
        })),
      });

      floors.set(room.floor, floorEntry);
    }

    return [...floors.values()].sort((left, right) => left.floor - right.floor);
  }
}
