import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class RoomFloorLabels1750300000000 implements MigrationInterface {
  name = 'RoomFloorLabels1750300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rooms"
      ALTER COLUMN "floor" TYPE varchar(16)
      USING (
        CASE "floor"
          WHEN 2 THEN '1-9'
          WHEN 3 THEN 'CC-15'
          WHEN 4 THEN '16-25'
          WHEN 5 THEN '26-31'
          ELSE "floor"::text
        END
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rooms"
      ALTER COLUMN "floor" TYPE integer
      USING (
        CASE "floor"
          WHEN '1-9' THEN 2
          WHEN 'CC-15' THEN 3
          WHEN '16-25' THEN 4
          WHEN '26-31' THEN 5
          ELSE NULL
        END
      )
    `);
  }
}
