import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class InitialSchema1749000000000 implements MigrationInterface {
  name = 'InitialSchema1749000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE TYPE "users_role_enum" AS ENUM ('DOCTOR', 'NURSE', 'ADMIN')
    `);

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
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "username" varchar(64) NOT NULL,
        "full_name" varchar(128) NOT NULL,
        "email" varchar(255),
        "email_verified_at" TIMESTAMPTZ,
        "password_hash" varchar(255) NOT NULL,
        "role" "users_role_enum" NOT NULL DEFAULT 'NURSE',
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_username" ON "users" ("username")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email")
    `);

    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "floor" varchar(16) NOT NULL,
        "name" varchar(64) NOT NULL,
        CONSTRAINT "PK_rooms" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_rooms_floor" ON "rooms" ("floor")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_rooms_floor_name" ON "rooms" ("floor", "name")
    `);

    await queryRunner.query(`
      CREATE TABLE "beds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "room_id" uuid NOT NULL,
        "name" varchar(64) NOT NULL,
        CONSTRAINT "PK_beds" PRIMARY KEY ("id"),
        CONSTRAINT "FK_beds_room_id"
          FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_beds_room_id_name" ON "beds" ("room_id", "name")
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
      CREATE INDEX "idx_patient_admissions_patient_bed_start"
      ON "patient_admissions" ("patient_id", "bed_id", "start_date")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_patient_admissions_patient_status"
      ON "patient_admissions" ("patient_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "daily_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "business_day_at" TIMESTAMPTZ NOT NULL,
        "bed_id" uuid NOT NULL,
        "morning_patient_name" varchar(255),
        "morning_patient_code" varchar(10),
        "evening_patient_name" varchar(255),
        "evening_patient_code" varchar(10),
        "morning_patient_admission_id" uuid,
        "evening_patient_admission_id" uuid,
        "morning_pulse" integer,
        "morning_temp" double precision,
        "morning_bp" varchar(32),
        "morning_note" varchar(500),
        "evening_pulse" integer,
        "evening_temp" double precision,
        "evening_bp" varchar(32),
        "evening_note" varchar(500),
        "is_locked" boolean NOT NULL DEFAULT false,
        "morning_entered_by_user_id" uuid,
        "evening_entered_by_user_id" uuid,
        CONSTRAINT "PK_daily_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_daily_records_bed_id"
          FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_daily_records_morning_patient_admission_id"
          FOREIGN KEY ("morning_patient_admission_id")
          REFERENCES "patient_admissions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_daily_records_evening_patient_admission_id"
          FOREIGN KEY ("evening_patient_admission_id")
          REFERENCES "patient_admissions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_daily_records_morning_entered_by_user_id"
          FOREIGN KEY ("morning_entered_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_daily_records_evening_entered_by_user_id"
          FOREIGN KEY ("evening_entered_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_daily_records_business_day_at_bed_id"
      ON "daily_records" ("business_day_at", "bed_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_business_day_at"
      ON "daily_records" ("business_day_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_bed_id"
      ON "daily_records" ("bed_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_morning_patient_code"
      ON "daily_records" ("morning_patient_code")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_evening_patient_code"
      ON "daily_records" ("evening_patient_code")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_morning_patient_admission_id"
      ON "daily_records" ("morning_patient_admission_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_daily_records_evening_patient_admission_id"
      ON "daily_records" ("evening_patient_admission_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_daily_records_bed_id_business_day_at"
      ON "daily_records" ("bed_id", "business_day_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_daily_records_morning_patient_name_trgm"
      ON "daily_records" USING gin ("morning_patient_name" gin_trgm_ops)
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_daily_records_evening_patient_name_trgm"
      ON "daily_records" USING gin ("evening_patient_name" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_evening_patient_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_morning_patient_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_bed_id_business_day_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_evening_patient_admission_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_morning_patient_admission_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_evening_patient_code"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_morning_patient_code"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_daily_records_bed_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_business_day_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_daily_records_business_day_at_bed_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_records"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_patient_admissions_patient_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_patient_admissions_patient_bed_start"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_patient_admissions_start_date_end_date"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_patient_admissions_bed_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_patient_admissions_patient_id_start_date"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "patient_admissions"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_patients_patient_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "patients"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_beds_room_id_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "beds"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rooms_floor_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rooms_floor"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rooms"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_username"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

    await queryRunner.query(
      `DROP TYPE IF EXISTS "patient_admission_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "patient_admission_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "patient_identity_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
  }
}
