import type {DatabaseSync} from 'node:sqlite';
import {schema} from './schema.ts';
import {featureMigration} from './features.ts';

export type MetadataMigration = {
  id: string;
  fromVersion: number;
  toVersion: number;
  steps: readonly {kind: 'ddl' | 'dml'; sql: string}[];
  dmlReason: string;
};

export const metadataMigrations: readonly MetadataMigration[] = [{
  id: '0001_initial_metadata', fromVersion: 0, toVersion: 1, steps: [{kind:'ddl',sql:schema}],
  dmlReason: 'Metadata records are created by application use cases; there is no deployment seed data.',
}, featureMigration];

export function migrationSql(migration: MetadataMigration): string {
  return `PRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n${migration.steps.map(step=>step.sql.trim()).join('\n')}\nPRAGMA user_version=${migration.toVersion};\nCOMMIT;\n`;
}

export function applyMetadataMigrations(db: DatabaseSync): void {
  let version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  const supported = new Set([0, ...metadataMigrations.map(migration => migration.toVersion)]);
  if (!supported.has(version)) throw new Error(`Unsupported metadata schema version ${version}`);
  for (const migration of metadataMigrations) {
    if (version >= migration.toVersion) continue;
    if (version !== migration.fromVersion) throw new Error(`Metadata migration gap at version ${version}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const step of migration.steps) db.exec(step.sql);
      db.exec(`PRAGMA user_version=${migration.toVersion}; COMMIT;`);
      version = migration.toVersion;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
