import {readFileSync} from 'node:fs';

// The caller owns BEGIN IMMEDIATE. All copies, constraints and the ledger
// commit together; an invalid legacy row rolls back the complete migration.
export function migrateExecutionSchema(db){
  const legacy=['sm_execution_deliveries','sm_execution_turns','sm_execution_wakes','sm_acceptance_checkpoints','sm_verification_evidence'];
  const present=new Set(legacy.filter(name=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)));
  for(const name of present)db.exec(`ALTER TABLE ${name} RENAME TO _v1_${name}`);
  db.exec(readFileSync(new URL('./execution-schema.sql',import.meta.url),'utf8'));
  if(present.has('sm_execution_turns')){
    const inconsistent=db.prepare('SELECT 1 FROM _v1_sm_execution_turns t JOIN sm_nodes n ON n.id=t.node_id WHERE t.task_id<>n.task_id LIMIT 1').get();
    if(inconsistent)throw Error('Legacy execution task/node mismatch; migration requires reconciliation');
    db.exec(`INSERT INTO sm_execution_turns(id,node_id,logical_session_id,generation,input_revision,room_seq,attempt,state,disposition,native_id,error,created_at,finished_at)
      SELECT id,node_id,logical_session_id,generation,input_revision,source_highwater,attempt,state,disposition,native_id,error,created_at,finished_at FROM _v1_sm_execution_turns;`);
  }
  if(present.has('sm_execution_deliveries')){
    const inconsistent=db.prepare('SELECT 1 FROM _v1_sm_execution_deliveries d JOIN sm_execution_turns t ON t.id=d.turn_id WHERE d.logical_session_id<>t.logical_session_id LIMIT 1').get();
    if(inconsistent)throw Error('Legacy delivery/session mismatch; migration requires reconciliation');
    db.exec('INSERT INTO sm_execution_messages SELECT event_id,turn_id,state FROM _v1_sm_execution_deliveries');
  }
  if(present.has('sm_execution_wakes'))db.exec('INSERT INTO sm_execution_wakes SELECT * FROM _v1_sm_execution_wakes');
  if(present.has('sm_verification_evidence'))db.exec('INSERT INTO sm_execution_verifications SELECT * FROM _v1_sm_verification_evidence');
  if(present.has('sm_acceptance_checkpoints'))db.exec('INSERT INTO sm_execution_acceptances SELECT * FROM _v1_sm_acceptance_checkpoints');
  // Every row has been copied through the canonical constraints before the
  // redundant legacy storage is removed. Compatibility views remain read-only.
  for(const name of legacy)if(present.has(name))db.exec(`DROP TABLE _v1_${name}`);
  db.exec(`INSERT INTO sm_execution_profiles(task_id,profile_id,revision)
    SELECT DISTINCT n.task_id,json_extract(n.config,'$.profile.id'),json_extract(n.config,'$.profile.revision') FROM sm_nodes n;
    INSERT INTO sm_execution_waits SELECT node_id,id,'WAITING',created_at FROM sm_execution_turns t
    WHERE state='WAITING' AND NOT EXISTS(SELECT 1 FROM sm_execution_turns later WHERE later.node_id=t.node_id AND later.attempt>t.attempt);`);
  if(db.prepare('PRAGMA foreign_key_check').get())throw Error('Foreign key violation during session migration');
}

export function migrateNormalizationSchema(db){
  const checks=[
    'SELECT 1 FROM sm_bot_task_sessions s JOIN sm_tasks t ON t.id=s.task_id WHERE s.workstation_id<>t.workstation_id',
    'SELECT 1 FROM sm_native_sessions n JOIN sm_bot_task_sessions s ON s.id=n.logical_session_id WHERE n.workstation_id<>s.workstation_id',
    'SELECT 1 FROM sm_workers w JOIN sm_nodes n ON n.id=w.node_id WHERE w.task_id<>n.task_id',
    'SELECT 1 FROM sm_results r JOIN sm_nodes n ON n.id=r.node_id WHERE r.task_id<>n.task_id',
    'SELECT 1 FROM sm_summaries s JOIN sm_soul_memory m ON m.id=s.memory_session_id WHERE s.workstation_id<>m.workstation_id',
    'SELECT 1 FROM sm_summaries s WHERE s.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sm_projects p WHERE p.workstation_id=s.workstation_id AND p.id=s.project_id)',
    "SELECT 1 FROM sm_summaries s,json_each(s.source_events) source WHERE NOT EXISTS(SELECT 1 FROM sm_events e JOIN sm_rooms r ON r.id=e.room_id JOIN sm_tasks t ON t.id=r.task_id WHERE e.id=source.value AND t.workstation_id=s.workstation_id AND (s.project_id IS NULL OR s.project_id=t.project_id))"
  ];
  for(const query of checks)if(db.prepare(query+' LIMIT 1').get())throw Error('Legacy scope mismatch; normalization requires reconciliation');
  db.exec('PRAGMA legacy_alter_table=ON');
  try{db.exec(readFileSync(new URL('./normalization-schema.sql',import.meta.url),'utf8'));}
  finally{db.exec('PRAGMA legacy_alter_table=OFF');}
  if(db.prepare('PRAGMA foreign_key_check').get())throw Error('Foreign key violation during session normalization');
}
