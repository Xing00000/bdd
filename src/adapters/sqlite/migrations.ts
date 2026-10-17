import type {DatabaseSync} from 'node:sqlite';
import {schema} from './schema.ts';
import {featureMigration} from './features.ts';
import {requirementMigration,projectGitMigration,defaultExampleMigration} from './requirements.ts';

export type MetadataMigration = {
  id: string;
  fromVersion: number;
  toVersion: number;
  steps: readonly {kind: 'ddl' | 'dml'; sql: string}[];
  dmlReason: string;
  rebuildTables?: boolean;
};

export const metadataMigrations: readonly MetadataMigration[] = [{
  id: '0001_initial_metadata', fromVersion: 0, toVersion: 1, steps: [{kind:'ddl',sql:schema}],
  dmlReason: 'Metadata records are created by application use cases; there is no deployment seed data.',
}, featureMigration,{
 id:'0003_dbgate_connection',fromVersion:2,toVersion:3,
 steps:[{kind:'ddl',sql:'ALTER TABLE target_connections ADD COLUMN dbgate_url TEXT; ALTER TABLE target_connections ADD COLUMN dbgate_connection_name TEXT;'}],
 dmlReason:'DbGate URLs are configured per target connection; no seed data is required.',
},requirementMigration,projectGitMigration,defaultExampleMigration];

export function migrationSql(migration: MetadataMigration): string {
  return `PRAGMA foreign_keys=${migration.rebuildTables?'OFF':'ON'};\nBEGIN IMMEDIATE;\n${migration.steps.map(step=>step.sql.trim()).join('\n')}\nCREATE TEMP TABLE migration_fk_check(failures INTEGER CHECK(failures=0));\nINSERT INTO migration_fk_check SELECT count(*) FROM pragma_foreign_key_check;\nDROP TABLE migration_fk_check;\nPRAGMA user_version=${migration.toVersion};\nCOMMIT;\nPRAGMA foreign_keys=ON;\n`;
}

export function applyMetadataMigrations(db: DatabaseSync): void {
  let version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  const supported = new Set([0, ...metadataMigrations.map(migration => migration.toVersion)]);
  if (!supported.has(version)) throw new Error(`Unsupported metadata schema version ${version}`);
  for (const migration of metadataMigrations) {
    if (version >= migration.toVersion) continue;
    if (version !== migration.fromVersion) throw new Error(`Metadata migration gap at version ${version}`);
    try {
      db.exec(migrationSql(migration));
      version = migration.toVersion;
    } catch (error) {
      if(db.isTransaction)db.exec('ROLLBACK');
      throw error;
    }finally{db.exec('PRAGMA foreign_keys=ON');}
  }
}
