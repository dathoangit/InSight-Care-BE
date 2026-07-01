import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class StripBedNamePrefix1749600000000 implements MigrationInterface {
  name = 'StripBedNamePrefix1749600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "beds"
      SET "name" = TRIM(REGEXP_REPLACE("name", '^Giường\\s+', '', 'i'))
      WHERE "name" ~* '^Giường\\s+'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "beds"
      SET "name" = 'Giường ' || "name"
      WHERE "name" !~* '^Giường\\s+'
    `);
  }
}
