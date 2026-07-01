import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DailyRecordEnteredBy1749400000000 implements MigrationInterface {
  name = 'DailyRecordEnteredBy1749400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "morning_entered_by_user_id" UUID
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "evening_entered_by_user_id" UUID
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD CONSTRAINT "FK_daily_records_morning_entered_by_user_id"
      FOREIGN KEY ("morning_entered_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD CONSTRAINT "FK_daily_records_evening_entered_by_user_id"
      FOREIGN KEY ("evening_entered_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP CONSTRAINT IF EXISTS "FK_daily_records_evening_entered_by_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP CONSTRAINT IF EXISTS "FK_daily_records_morning_entered_by_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "evening_entered_by_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "morning_entered_by_user_id"
    `);
  }
}
