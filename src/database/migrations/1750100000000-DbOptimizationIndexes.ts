import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DbOptimizationIndexes1750100000000 implements MigrationInterface {
  name = 'DbOptimizationIndexes1750100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_daily_records_bed_id_business_day_at"
      ON "daily_records" ("bed_id", "business_day_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_patient_admissions_patient_bed_start"
      ON "patient_admissions" ("patient_id", "bed_id", "start_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_patient_admissions_patient_status"
      ON "patient_admissions" ("patient_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_patient_admissions_patient_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_patient_admissions_patient_bed_start"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_bed_id_business_day_at"`,
    );
  }
}
