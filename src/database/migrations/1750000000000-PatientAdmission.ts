import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PatientAdmission1750000000000 implements MigrationInterface {
  name = 'PatientAdmission1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "patient_identity_type_enum" AS ENUM ('code', 'no_code')
    `);

    await queryRunner.query(`
      CREATE TYPE "patient_admission_status_enum" AS ENUM ('active', 'discharged')
    `);

    await queryRunner.query(`
      CREATE TYPE "patient_admission_source_enum" AS ENUM ('with_code', 'no_code')
    `);

    await queryRunner.query(`
      CREATE TABLE "patients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "patient_code" varchar(10),
        "display_name" varchar(255),
        "identity_type" "patient_identity_type_enum" NOT NULL,
        CONSTRAINT "PK_patients" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_patients_patient_code"
      ON "patients" ("patient_code")
      WHERE "patient_code" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "patient_admissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "patient_id" uuid NOT NULL,
        "bed_id" uuid NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date,
        "status" "patient_admission_status_enum" NOT NULL DEFAULT 'active',
        "source" "patient_admission_source_enum" NOT NULL,
        CONSTRAINT "PK_patient_admissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_admissions_patient_id"
          FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_patient_admissions_bed_id"
          FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_patient_admissions_patient_id_start_date"
      ON "patient_admissions" ("patient_id", "start_date")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_patient_admissions_bed_id_status"
      ON "patient_admissions" ("bed_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_patient_admissions_start_date_end_date"
      ON "patient_admissions" ("start_date", "end_date")
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "morning_patient_admission_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "evening_patient_admission_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD CONSTRAINT "FK_daily_records_morning_patient_admission_id"
      FOREIGN KEY ("morning_patient_admission_id")
      REFERENCES "patient_admissions"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD CONSTRAINT "FK_daily_records_evening_patient_admission_id"
      FOREIGN KEY ("evening_patient_admission_id")
      REFERENCES "patient_admissions"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_records_morning_patient_admission_id"
      ON "daily_records" ("morning_patient_admission_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_records_evening_patient_admission_id"
      ON "daily_records" ("evening_patient_admission_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_daily_records_evening_patient_admission_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_daily_records_morning_patient_admission_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP CONSTRAINT IF EXISTS "FK_daily_records_evening_patient_admission_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP CONSTRAINT IF EXISTS "FK_daily_records_morning_patient_admission_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "evening_patient_admission_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records"
      DROP COLUMN IF EXISTS "morning_patient_admission_id"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_patient_admissions_start_date_end_date"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_patient_admissions_bed_id_status"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_patient_admissions_patient_id_start_date"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "patient_admissions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_patients_patient_code"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "patients"`);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "patient_admission_source_enum"`,
    );

    await queryRunner.query(
      `DROP TYPE IF EXISTS "patient_admission_status_enum"`,
    );

    await queryRunner.query(`DROP TYPE IF EXISTS "patient_identity_type_enum"`);
  }
}
