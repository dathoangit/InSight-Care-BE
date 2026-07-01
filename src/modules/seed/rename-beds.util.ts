import { type QueryRunner } from 'typeorm';

import { buildBedNames } from './bed-name.utils';

interface IBedRow {
  id: string;
  name: string;
}

interface IRoomRow {
  id: string;
  name: string;
}

async function renameBedsInRoom(
  queryRunner: QueryRunner,
  room: IRoomRow,
): Promise<number> {
  const beds = (await queryRunner.query(
    `
        SELECT id, name
        FROM beds
        WHERE room_id = $1
        ORDER BY name ASC
      `,
    [room.id],
  )) as IBedRow[];

  const newNames = buildBedNames(room.name, beds.length);
  const updates = beds
    .map((bed, index) => ({ bed, nextName: newNames[index] }))
    .filter(({ bed, nextName }) => bed.name !== nextName);

  await Promise.all(
    updates.map(({ bed, nextName }) =>
      queryRunner.query(
        `
          UPDATE beds
          SET name = $1, updated_at = NOW()
          WHERE id = $2
        `,
        [nextName, bed.id],
      ),
    ),
  );

  return updates.length;
}

async function revertBedsInRoom(
  queryRunner: QueryRunner,
  roomId: string,
): Promise<number> {
  const beds = (await queryRunner.query(
    `
        SELECT id, name
        FROM beds
        WHERE room_id = $1
        ORDER BY name ASC
      `,
    [roomId],
  )) as IBedRow[];

  const updates = beds
    .map((bed, index) => ({ bed, nextName: String(index + 1) }))
    .filter(({ bed, nextName }) => bed.name !== nextName);

  await Promise.all(
    updates.map(({ bed, nextName }) =>
      queryRunner.query(
        `
          UPDATE beds
          SET name = $1, updated_at = NOW()
          WHERE id = $2
        `,
        [nextName, bed.id],
      ),
    ),
  );

  return updates.length;
}

export async function renameAllBeds(queryRunner: QueryRunner): Promise<number> {
  const rooms = (await queryRunner.query(`
    SELECT DISTINCT r.id, r.name
    FROM rooms r
    INNER JOIN beds b ON b.room_id = r.id
    ORDER BY r.name
  `)) as IRoomRow[];

  const counts = await Promise.all(
    rooms.map((room) => renameBedsInRoom(queryRunner, room)),
  );

  return counts.reduce((total, count) => total + count, 0);
}

export async function revertBedsToNumericNames(
  queryRunner: QueryRunner,
): Promise<number> {
  const rooms = (await queryRunner.query(`
    SELECT DISTINCT r.id
    FROM rooms r
    INNER JOIN beds b ON b.room_id = r.id
    ORDER BY r.id
  `)) as Array<{ id: string }>;

  const counts = await Promise.all(
    rooms.map((room) => revertBedsInRoom(queryRunner, room.id)),
  );

  return counts.reduce((total, count) => total + count, 0);
}
