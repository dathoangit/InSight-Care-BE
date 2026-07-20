import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class PgTrgmNameSearch1750200000000 implements MigrationInterface {
  name = 'PgTrgmNameSearch1750200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type;

    if (dbType !== 'postgres') {
      return;
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_daily_records_morning_patient_name_trgm"
      ON "daily_records" USING gin ("morning_patient_name" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_daily_records_evening_patient_name_trgm"
      ON "daily_records" USING gin ("evening_patient_name" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type;

    if (dbType !== 'postgres') {
      return;
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_evening_patient_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_daily_records_morning_patient_name_trgm"`,
    );
  }
}
