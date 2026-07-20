import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddUserFullName1750400000000 implements MigrationInterface {
  name = 'AddUserFullName1750400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "full_name" varchar(128)
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "full_name" = "username"
      WHERE "full_name" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "full_name" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "full_name"
    `);
  }
}
