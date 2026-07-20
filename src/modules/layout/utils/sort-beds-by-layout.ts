import { compareFloorLabels } from '../constants/floor-labels';
import { type BedEntity } from '../entities/bed.entity';

export function sortBedsByLayout(beds: BedEntity[]): BedEntity[] {
  return [...beds].sort((left, right) => {
    const floorDiff = compareFloorLabels(left.room.floor, right.room.floor);

    if (floorDiff !== 0) {
      return floorDiff;
    }

    const roomDiff = left.room.name.localeCompare(right.room.name, 'vi');

    if (roomDiff !== 0) {
      return roomDiff;
    }

    return left.name.localeCompare(right.name, 'vi');
  });
}
