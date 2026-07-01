import { type MigrationInterface, type QueryRunner } from 'typeorm';

import {
  renameAllBeds,
  revertBedsToNumericNames,
} from '../../modules/seed/rename-beds.util';

export class RenameBedsWithSuffix1749700000000 implements MigrationInterface {
  name = 'RenameBedsWithSuffix1749700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await renameAllBeds(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await revertBedsToNumericNames(queryRunner);
  }
}
