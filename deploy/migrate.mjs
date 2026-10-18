import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';

const args=process.argv.slice(2);
if(!([1,3].includes(args.length))||(args.length===3&&args[1]!=='--backup'))
  throw new Error('Usage: node deploy/migrate.mjs <database-file> [--backup <new-backup-file>]');
const root=await fs.realpath(fileURLToPath(new URL('.',import.meta.url)));
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
if(manifest.schemaVersion!==1||manifest.dialect!=='sqlite'||!Array.isArray(manifest.migrations)||!manifest.migrations.length)
  throw new Error('Invalid SQLite deployment manifest');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function verifiedFile(entry){
  if(!entry||typeof entry.path!=='string'||path.isAbsolute(entry.path))throw new Error('Invalid deployment member');
  const file=await fs.realpath(path.resolve(root,entry.path));
  const relative=path.relative(root,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Deployment member escapes bundle');
  const bytes=await fs.readFile(file);
  if(hash(bytes)!==entry.sha256)throw new Error('Deployment hash mismatch: '+entry.path);
  return bytes.toString('utf8');
}
if(hash(await fs.readFile(fileURLToPath(import.meta.url)))!==manifest.runner?.sha256)throw new Error('Deployment runner hash mismatch');
let expectedVersion=0;
const migrations=[];
for(const migration of manifest.migrations){
  if(migration.fromVersion!==expectedVersion||migration.toVersion!==expectedVersion+1||!Array.isArray(migration.dml))
    throw new Error('Invalid migration order');
  await verifiedFile(migration.ddl);
  for(const entry of migration.dml)await verifiedFile(entry);
  migrations.push({...migration,raw:await verifiedFile(migration.sql)});
  expectedVersion=migration.toVersion;
}
if(manifest.targetVersion!==expectedVersion)throw new Error('Target schema version mismatch');
const databaseFile=path.resolve(args[0]);
let existing=true;try{await fs.stat(databaseFile);}catch(error){if(error.code==='ENOENT')existing=false;else throw error;}
if(!existing){const handle=await fs.open(databaseFile,'wx',0o600);await handle.close();}
const db=new DatabaseSync(databaseFile);
try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
  let version=Number(db.prepare('PRAGMA user_version').get().user_version);
  if(![0,...migrations.map(migration=>migration.toVersion)].includes(version))throw new Error('Unsupported database schema version '+version);
  const pending=migrations.filter(migration=>migration.toVersion>version);
  let backupFile=null;
  if(existing&&pending.length){
    if(args.length!==3)throw new Error('Existing database requires --backup before migration');
    backupFile=path.resolve(args[2]);
    const handle=await fs.open(backupFile,'wx',0o600);await handle.close();
    await backup(db,backupFile);
  }
  const applied=[];
  for(const migration of pending){
    if(version!==migration.fromVersion)throw new Error('Database changed before migration');
    try{db.exec(migration.raw);}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    version=Number(db.prepare('PRAGMA user_version').get().user_version);
    if(version!==migration.toVersion)throw new Error('Migration did not update schema version');
    applied.push(migration.id);
  }
  console.log(JSON.stringify({databaseFile,version,applied,backupFile}));
}finally{db.close();}
