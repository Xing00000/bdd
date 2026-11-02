/** SQLite is the canonical owner of execution output and process metadata. */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,existsSync,lstatSync} from 'node:fs';
import path from 'node:path';

export function installProgressSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS execution_logs (
    operation_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0,
    phase_json TEXT, processes_json TEXT NOT NULL DEFAULT '[]', exit_json TEXT,
    updated_at TEXT NOT NULL, legacy_imported INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS execution_log_chunks (
    operation_id TEXT NOT NULL REFERENCES execution_logs(operation_id),
    byte_offset INTEGER NOT NULL, content BLOB NOT NULL,
    PRIMARY KEY(operation_id,byte_offset)
  );`);
}

export function appendExecutionLog(db,operationId,content) {
  const buffer=Buffer.from(content),now=new Date().toISOString();
  const ownTransaction=!db.isTransaction;
  if(ownTransaction)db.exec('BEGIN IMMEDIATE');
  try {
  db.prepare('INSERT OR IGNORE INTO execution_logs(operation_id,updated_at) VALUES(?,?)').run(operationId,now);
  const {bytes}=db.prepare('SELECT bytes FROM execution_logs WHERE operation_id=?').get(operationId);
  if(buffer.length&&bytes+buffer.length<=4*1024*1024) {
    db.prepare('INSERT INTO execution_log_chunks VALUES(?,?,?)').run(operationId,bytes,buffer);
    db.prepare('UPDATE execution_logs SET bytes=bytes+?,updated_at=? WHERE operation_id=?').run(buffer.length,now,operationId);
  }
  if(ownTransaction)db.exec('COMMIT');
  }catch(error){if(ownTransaction)db.exec('ROLLBACK');throw error;}
}

export function openProgressStore(home) {
  mkdirSync(home,{recursive:true,mode:0o700});
  const db=new DatabaseSync(path.join(home,'metadata.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  installProgressSchema(db);
  const get=operationId=>db.prepare('SELECT * FROM execution_logs WHERE operation_id=?').get(operationId);
  const ensure=operationId=>db.prepare('INSERT OR IGNORE INTO execution_logs(operation_id,updated_at) VALUES(?,?)').run(operationId,new Date().toISOString());
  const append=(operationId,content)=>{
    const buffer=Buffer.from(content);if(!buffer.length)return;
    db.exec('BEGIN IMMEDIATE');
    try {
      appendExecutionLog(db,operationId,buffer);
      db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
  };
  return {
    close:()=>db.close(),ensure,get,append,
    update(operationId,field,value) {
      if(!['phase_json','processes_json','exit_json'].includes(field))throw new Error('Unknown execution metadata');
      ensure(operationId);db.prepare(`UPDATE execution_logs SET ${field}=?,updated_at=? WHERE operation_id=?`).run(JSON.stringify(value),new Date().toISOString(),operationId);
    },
    touch(operationId){ensure(operationId);db.prepare('UPDATE execution_logs SET updated_at=? WHERE operation_id=?').run(new Date().toISOString(),operationId);},
    read(operationId) {
      const row=get(operationId);if(!row)return null;
      const chunks=db.prepare('SELECT content FROM execution_log_chunks WHERE operation_id=? ORDER BY byte_offset').all(operationId);
      return {output:Buffer.concat(chunks.map(chunk=>Buffer.from(chunk.content))),state:row.phase_json?JSON.parse(row.phase_json):{phase:'PREPARING'},processes:JSON.parse(row.processes_json),latestExit:row.exit_json?JSON.parse(row.exit_json):null,updatedAt:row.updated_at,legacyImported:Boolean(row.legacy_imported)};
    },
    importLegacy(operationId) {
      if(get(operationId))return;
      const directory=path.join(home,'development',operationId),names=['terminal.log','state.json','processes.json','terminal-exit.json'];
      for(const candidate of [path.join(home,'development'),directory])if(existsSync(candidate)&&lstatSync(candidate).isSymbolicLink())throw new Error('Legacy log symlinks are not allowed');
      if(!names.some(name=>existsSync(path.join(directory,name))))return;
      const content={};let latest=0;
      for(const name of names){const file=path.join(directory,name);if(!existsSync(file))continue;const stat=lstatSync(file);if(!stat.isFile()||stat.size>(name==='terminal.log'?4*1024*1024:1024*1024))throw new Error('Invalid legacy execution log');latest=Math.max(latest,stat.mtimeMs);content[name]=readFileSync(file);}
      const json=name=>content[name]?JSON.parse(content[name].toString('utf8')):null;
      const state=json('state.json'),processes=json('processes.json')??[],exit=json('terminal-exit.json');
      if(!Array.isArray(processes)||processes.length>4096)throw new Error('Invalid legacy process metadata');
      db.exec('BEGIN IMMEDIATE');
      try {
        if(!get(operationId)) {
          const output=content['terminal.log']??Buffer.alloc(0);
          db.prepare('INSERT INTO execution_logs VALUES(?,?,?,?,?,?,1)').run(operationId,output.length,state?JSON.stringify(state):null,JSON.stringify(processes),exit?JSON.stringify(exit):null,new Date(latest).toISOString());
          if(output.length)db.prepare('INSERT INTO execution_log_chunks VALUES(?,?,?)').run(operationId,0,output);
        }
        db.exec('COMMIT');
      } catch(error){db.exec('ROLLBACK');throw error;}
    }
  };
}

export function readProgress(home,operationId) {
  const store=openProgressStore(home);
  try {store.importLegacy(operationId);return store.read(operationId);}finally{store.close();}
}

export function saveProgressPhase(home,operationId,state) {
  const store=openProgressStore(home);try{store.update(operationId,'phase_json',state);}finally{store.close();}
}
