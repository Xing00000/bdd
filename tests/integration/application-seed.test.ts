import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {applyMetadataMigrations} from '../../src/adapters/sqlite/migrations.ts';
import {renderApplicationSeedSql,renderWorkflowAgentUpgradeSql} from '../../src/adapters/sqlite/seed.ts';

test('application seeds preserve literal Skill text and keep every default association intact',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'bdd-literal-seed-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const instructions="# Playwright BDD\r\nPreserve literal replacements: $& $$ $` $'.\r\n保留 O'Brien 與中文原文。\n";
 await mkdir(path.join(root,'skills/playwright-bdd'),{recursive:true});
 await writeFile(path.join(root,'skills/playwright-bdd/SKILL.md'),instructions);
 const db=new DatabaseSync(':memory:');
 try{
  applyMetadataMigrations(db);
  db.exec(renderApplicationSeedSql(root));
  assert.equal(db.prepare("SELECT instructions FROM llm_skills WHERE name='Playwright BDD'").get()!.instructions,instructions);
  const associations=()=>db.prepare('SELECT a.id,a.name,a.prompt,c.name command,s.instructions,w.stage,w.position FROM llm_agents a JOIN llm_cli_commands c ON c.id=a.cli_command_id JOIN llm_skills s ON s.id=a.skill_id JOIN workflow_agent_assignments w ON w.agent_id=a.id ORDER BY w.stage').all();
  const initial=associations();assert.equal(initial.length,4);
  assert.deepEqual(initial.map(row=>row.stage),['GHERKIN','IMPLEMENTATION','SD','TESTS']);
  for(const row of initial){assert.equal(row.command,'Codex CLI');assert.equal(row.instructions,instructions);assert.equal(row.position,0);assert.ok(String(row.prompt).trim());}
  db.exec(renderApplicationSeedSql(root));db.exec(renderWorkflowAgentUpgradeSql(root));
  assert.deepEqual(associations(),initial);
  assert.equal(db.prepare('SELECT count(*) count FROM llm_cli_commands').get()!.count,2);
  assert.equal(db.prepare('SELECT count(*) count FROM llm_skills').get()!.count,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
