import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class DropUnusedAuthTables1749500000000 implements MigrationInterface {
  name = 'DropUnusedAuthTables1749500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_oauth_identities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_verifications"`);
  }

  public async down(): Promise<void> {
    // Auth auxiliary tables were removed from the application; restore manually if needed.
  }
}
