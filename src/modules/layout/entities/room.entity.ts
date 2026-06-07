import { Column, Entity, Index, OneToMany } from 'typeorm';

import { AbstractEntity } from '../../../common/abstract.entity';
import { BedEntity } from './bed.entity';

@Entity({ name: 'rooms' })
@Index(['floor', 'name'], { unique: true })
export class RoomEntity extends AbstractEntity {
  @Index()
  @Column({ type: 'int' })
  floor!: number;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @OneToMany(() => BedEntity, (bed) => bed.room)
  beds!: BedEntity[];
}
