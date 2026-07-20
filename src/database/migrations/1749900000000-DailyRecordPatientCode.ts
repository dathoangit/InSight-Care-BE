import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DailyRecordPatientCode1749900000000 implements MigrationInterface {
  name = 'DailyRecordPatientCode1749900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "morning_patient_code" varchar(10)
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "evening_patient_code" varchar(10)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_records_morning_patient_code"
      ON "daily_records" ("morning_patient_code")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_records_evening_patient_code"
      ON "daily_records" ("evening_patient_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_daily_records_evening_patient_code"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_daily_records_morning_patient_code"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "evening_patient_code"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "morning_patient_code"
    `);
  }
}
