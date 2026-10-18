import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {metadataMigrations, migrationSql} from '../dist/src/adapters/sqlite/migrations.js';
import {renderApplicationSeedSql,renderWorkflowAgentUpgradeSql} from '../dist/src/adapters/sqlite/seed.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'deploy');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['src/adapters/sqlite/schema.ts','src/adapters/sqlite/migrations.ts','src/adapters/sqlite/features.ts','src/adapters/sqlite/llm-settings.ts','src/adapters/sqlite/workflow-settings.ts','src/adapters/sqlite/seed.ts','src/domain/workflow-agent-stages.ts','src/adapters/sqlite/seed.sql','skills/playwright-bdd/SKILL.md','tools/deploy.mjs','tools/migrate.mjs','tools/dbgate.Dockerfile'];
const sources=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await fs.readFile(path.join(root,file)))])));
const manifest={schemaVersion:1,dialect:'sqlite',targetVersion:0,sources,migrations:[]};
let version=0;
const emit=async(file,raw)=>{await fs.mkdir(path.dirname(path.join(output,file)),{recursive:true});await fs.writeFile(path.join(output,file),raw);return {path:file,sha256:hash(raw)};};
for(const migration of metadataMigrations){
  if(migration.fromVersion!==version||migration.toVersion!==version+1||!/^\d+_[a-z0-9_]+$/.test(migration.id)||!migration.steps.length)
    throw new Error('Invalid canonical migration sequence: '+migration.id);
  const ddlSql=migration.steps.filter(step=>step.kind==='ddl').map(step=>step.sql).join('\n');
  const dmlSql=migration.steps.filter(step=>step.kind==='dml').map(step=>step.sql).join('\n');
  const ddl=await emit(`ddl/${migration.id}.sql`,ddlSql.trim()+'\n');
  const dml=dmlSql.trim()?[await emit(`dml/${migration.id}.sql`,dmlSql.trim()+'\n')]:[];
  const sql=await emit(`migrations/${migration.id}.sql`,migrationSql(migration));
  manifest.migrations.push({id:migration.id,fromVersion:migration.fromVersion,toVersion:migration.toVersion,ddl,dml,dmlReason:migration.dmlReason,sql});
  version=migration.toVersion;
}
manifest.targetVersion=version;
const runner=await fs.readFile(path.join(root,'tools/migrate.mjs'),'utf8');
manifest.runner=await emit('migrate.mjs',runner);
manifest.seed=await emit('seed.sql',renderApplicationSeedSql(root));
manifest.seedUpgrade=await emit('seed-upgrade.sql',renderWorkflowAgentUpgradeSql(root));
manifest.dbgate={dockerfile:await emit('dbgate/Dockerfile',await fs.readFile(path.join(root,'tools/dbgate.Dockerfile'),'utf8'))};
await emit('manifest.json',JSON.stringify(manifest,null,2)+'\n');
await emit('README.md',`# Metadata deployment\n\nGenerated from the canonical schema/migrations; do not edit SQL by hand.\n\nNode.js 24 is required. Review manifest.json and the target database path.\n\nNew database: node deploy/migrate.mjs /absolute/path/metadata.sqlite\nExisting database: node deploy/migrate.mjs /absolute/path/metadata.sqlite --backup /absolute/path/before-migration.sqlite\n\nThe runner verifies all SQL hashes and schema versions before applying migrations. An existing database with pending migrations requires a new backup path; existing backup files are never overwritten. Applied migrations are not rerun. The application applies seed.sql and any pending seed-upgrade.sql once per recorded seed key at startup after schema migrations. Do not apply seed files by hand; the application wraps each in a transaction and records its key.\n\nDDL and DML files are inspection views; execute only complete transactional migrations in migrations/ to preserve step order. Deployment DML is listed per migration; no DML file is generated when no schema migration DML is required. Business transaction examples and test fixtures are not deployment DML.\n\nA failed transaction rolls back. To restore committed or destructive changes, stop the application and restore the explicitly created SQLite backup; generated SQL does not invent a reversible down migration.\n`);
console.log(JSON.stringify({output:'deploy',migrations:manifest.migrations.length,targetVersion:version,execution:'NOT_RUN'}));
