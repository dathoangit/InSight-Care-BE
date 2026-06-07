import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { RoomEntity } from './room.entity';

@Entity({ name: 'beds' })
@Index(['roomId', 'name'], { unique: true })
export class BedEntity extends AbstractEntity {
  @Column({ name: 'room_id', type: 'uuid' })
  roomId!: Uuid;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @ManyToOne(() => RoomEntity, (room) => room.beds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room!: RoomEntity;
}
