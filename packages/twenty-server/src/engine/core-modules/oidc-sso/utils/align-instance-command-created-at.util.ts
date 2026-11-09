import { Logger } from '@nestjs/common';

import { type DataSource } from 'typeorm';

import { type UpgradeSequenceReaderService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';

type InstanceCommandRow = { id: string; name: string; createdAt: Date };

const logger = new Logger('AlignInstanceCommandCreatedAt');

// The upgrade-aware ORM takes its cursor from the newest instance row of
// core.upgradeMigration. The fork runs its OIDC command after `upgrade`, so that
// row is the newest and pulls the cursor behind already applied renames.
// ponytail: one row per run and millisecond precision (neighbours less than 2 ms
// apart give a tie); a second misplaced row is fixed on the next boot.
export const planInstanceCommandCreatedAtAlignment = ({
  rows,
  sequenceNames,
}: {
  rows: InstanceCommandRow[];
  sequenceNames: string[];
}): { id: string; createdAt: Date } | null => {
  const indexByName = new Map(
    sequenceNames.map((name, index) => [name, index]),
  );

  const rowsInSequenceOrder = rows
    .filter((row) => indexByName.has(row.name))
    .sort((a, b) => indexByName.get(a.name)! - indexByName.get(b.name)!);

  const newestPosition = rowsInSequenceOrder.reduce(
    (newest, row, position) =>
      row.createdAt.getTime() >= rowsInSequenceOrder[newest].createdAt.getTime()
        ? position
        : newest,
    0,
  );

  const next = rowsInSequenceOrder[newestPosition + 1];

  if (next === undefined) {
    return null;
  }

  const previous = rowsInSequenceOrder[newestPosition - 1];
  const previousTime = previous
    ? previous.createdAt.getTime()
    : next.createdAt.getTime() - 2;

  return {
    id: rowsInSequenceOrder[newestPosition].id,
    createdAt: new Date((previousTime + next.createdAt.getTime()) / 2),
  };
};

export const alignInstanceCommandCreatedAt = async ({
  dataSource,
  upgradeSequenceReaderService,
}: {
  dataSource: DataSource;
  upgradeSequenceReaderService: UpgradeSequenceReaderService;
}): Promise<void> => {
  try {
    const rows: InstanceCommandRow[] = await dataSource.query(
      `SELECT m.id, m.name, m."createdAt"
       FROM core."upgradeMigration" m
       WHERE m."workspaceId" IS NULL AND m."isInitial" = false
         AND m.attempt = (
           SELECT MAX(s.attempt) FROM core."upgradeMigration" s
           WHERE s.name = m.name AND s."workspaceId" IS NULL
         )`,
    );

    const update = planInstanceCommandCreatedAtAlignment({
      rows,
      sequenceNames: upgradeSequenceReaderService.getUpgradeStepNames(),
    });

    if (update === null) {
      return;
    }

    await dataSource.query(
      `UPDATE core."upgradeMigration" SET "createdAt" = $1 WHERE id = $2`,
      [update.createdAt, update.id],
    );
  } catch (error) {
    logger.warn(
      `Could not align the upgrade cursor: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};
