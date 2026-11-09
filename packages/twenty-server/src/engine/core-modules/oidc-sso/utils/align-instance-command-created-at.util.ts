import { type DataSource } from 'typeorm';

type InstanceCommandRow = { id: string; name: string; createdAt: Date };

// The upgrade-aware ORM derives its cursor from the newest core.upgradeMigration
// row. The fork runs its OIDC command out of order (run-instance-commands, after
// `upgrade`), so that row becomes the newest and pulls the cursor back behind
// already applied renames. Reassigning the existing timestamps in sequence order
// makes "newest" mean "furthest in the sequence" again. No-op when already ordered.
export const planInstanceCommandCreatedAtAlignment = ({
  rows,
  sequenceNames,
}: {
  rows: InstanceCommandRow[];
  sequenceNames: string[];
}): { id: string; createdAt: Date }[] => {
  const indexByName = new Map(
    sequenceNames.map((name, index) => [name, index]),
  );

  const inSequenceOrder = rows
    .filter((row) => indexByName.has(row.name))
    .sort((a, b) => indexByName.get(a.name)! - indexByName.get(b.name)!);

  const timestamps = inSequenceOrder
    .map((row) => row.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  return inSequenceOrder.flatMap((row, position) =>
    row.createdAt.getTime() === timestamps[position].getTime()
      ? []
      : [{ id: row.id, createdAt: timestamps[position] }],
  );
};

export const alignInstanceCommandCreatedAt = async ({
  dataSource,
  sequenceNames,
}: {
  dataSource: DataSource;
  sequenceNames: string[];
}): Promise<number> => {
  const rows: InstanceCommandRow[] = await dataSource.query(
    `SELECT m.id, m.name, m."createdAt"
     FROM core."upgradeMigration" m
     WHERE m."workspaceId" IS NULL AND m."isInitial" = false
       AND m.attempt = (
         SELECT MAX(s.attempt) FROM core."upgradeMigration" s
         WHERE s.name = m.name AND s."workspaceId" IS NULL
       )`,
  );

  const updates = planInstanceCommandCreatedAtAlignment({
    rows,
    sequenceNames,
  });

  for (const update of updates) {
    await dataSource.query(
      `UPDATE core."upgradeMigration" SET "createdAt" = $1 WHERE id = $2`,
      [update.createdAt, update.id],
    );
  }

  return updates.length;
};
