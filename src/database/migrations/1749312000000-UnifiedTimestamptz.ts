import { type MigrationInterface, type QueryRunner } from 'typeorm';

const AUDIT_TABLES = [
  'users',
  'rooms',
  'beds',
  'daily_records',
  'email_verifications',
  'password_reset_tokens',
  'user_oauth_identities',
] as const;

export class UnifiedTimestamptz1749312000000 implements MigrationInterface {
  name = 'UnifiedTimestamptz1749312000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasDateColumn = await queryRunner.hasColumn('daily_records', 'date');
    const hasBusinessDayAt = await queryRunner.hasColumn(
      'daily_records',
      'business_day_at',
    );

    if (hasDateColumn && !hasBusinessDayAt) {
      await queryRunner.query(`
        ALTER TABLE "daily_records"
        ADD COLUMN IF NOT EXISTS "business_day_at" TIMESTAMPTZ
      `);

      await queryRunner.query(`
        UPDATE "daily_records"
        SET "business_day_at" = ("date"::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        WHERE "business_day_at" IS NULL
      `);

      await queryRunner.query(`
        ALTER TABLE "daily_records"
        ALTER COLUMN "business_day_at" SET NOT NULL
      `);

      await queryRunner.query(`
        DROP INDEX IF EXISTS "IDX_daily_records_date_bed_id"
      `);

      await queryRunner.query(`
        ALTER TABLE "daily_records" DROP COLUMN "date"
      `);
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_daily_records_business_day_at_bed_id"
      ON "daily_records" ("business_day_at", "bed_id")
    `);

    await Promise.all(
      AUDIT_TABLES.flatMap((table) => [
        queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "created_at" TYPE TIMESTAMPTZ
        USING "created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
      `),
        queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ
        USING "updated_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
      `),
      ]),
    );

    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "email_verified_at" TYPE TIMESTAMPTZ
      USING "email_verified_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `);

    await queryRunner.query(`
      ALTER TABLE "email_verifications"
      ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ
      USING "expires_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `);

    await queryRunner.query(`
      ALTER TABLE "email_verifications"
      ALTER COLUMN "consumed_at" TYPE TIMESTAMPTZ
      USING "consumed_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `);

    await queryRunner.query(`
      ALTER TABLE "password_reset_tokens"
      ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ
      USING "expires_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `);

    await queryRunner.query(`
      ALTER TABLE "password_reset_tokens"
      ALTER COLUMN "used_at" TYPE TIMESTAMPTZ
      USING "used_at" AT TIME ZONE 'Asia/Ho_Chi_Minh'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_records"
      ADD COLUMN IF NOT EXISTS "date" DATE
    `);

    await queryRunner.query(`
      UPDATE "daily_records"
      SET "date" = ("business_day_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      WHERE "date" IS NULL
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_daily_records_business_day_at_bed_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "daily_records" DROP COLUMN IF EXISTS "business_day_at"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_daily_records_date_bed_id"
      ON "daily_records" ("date", "bed_id")
    `);
  }
}
