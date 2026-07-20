import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddMedicalRecordCode1753000000000 implements MigrationInterface {
  name = 'AddMedicalRecordCode1753000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patient_admissions"
      ADD COLUMN "medical_record_code" varchar(10)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_patient_admissions_medical_record_code"
      ON "patient_admissions" ("medical_record_code")
      WHERE "medical_record_code" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN "morning_medical_record_code" varchar(10),
      ADD COLUMN "evening_medical_record_code" varchar(10)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_morning_medical_record_code"
      ON "daily_records" ("morning_medical_record_code")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_evening_medical_record_code"
      ON "daily_records" ("evening_medical_record_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_evening_medical_record_code"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_morning_medical_record_code"`,
    );
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "evening_medical_record_code",
      DROP COLUMN IF EXISTS "morning_medical_record_code"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_patient_admissions_medical_record_code"`,
    );
    await queryRunner.query(`
      ALTER TABLE "patient_admissions"
      DROP COLUMN IF EXISTS "medical_record_code"
    `);
  }
}
