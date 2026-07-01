import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DailyRecordNotes1749800000000 implements MigrationInterface {
  name = 'DailyRecordNotes1749800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "morning_note" varchar(500)
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "evening_note" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "evening_note"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "morning_note"
    `);
  }
}
