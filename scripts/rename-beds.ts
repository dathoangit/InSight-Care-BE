/**
 * Rename all beds to the A/B and cc1–cc4 naming scheme.
 *
 * Usage:
 *   yarn rename:beds
 */
import dataSource from '../ormconfig';
import { renameAllBeds } from '../src/modules/seed/rename-beds.util';

try {
  await dataSource.initialize();

  try {
    const updated = await dataSource.transaction(async (manager) => {
      const queryRunner = manager.queryRunner;

      if (!queryRunner) {
        throw new Error('Query runner is not available in the transaction');
      }

      return renameAllBeds(queryRunner);
    });

    console.info(`Renamed ${updated} bed(s).`);
  } finally {
    await dataSource.destroy();
  }
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
