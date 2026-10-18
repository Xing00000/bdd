import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cliProposal} from '../../src/adapters/generation/cli.ts';
import type {TerminalRuntimePort} from '../../src/ports/runtime.ts';

test('terminal proposal opens the scoped interactive command and consumes an actual file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-proposal-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let directory='',command:any,opened:any,listener:any,closed=false;const sessions=new Set<string>();
 const terminal:TerminalRuntimePort={async create(input){directory=input.workspaceRef;command=input.command;sessions.add('controlled-session');return {id:'controlled-session'};},input(){},resize(){},hasSession(id){return sessions.has(id);},subscribe(_id,callback){listener=callback;return()=>{listener=undefined;};},closeTerminal(id){closed=true;sessions.delete(id);},close(){sessions.clear();}};
 const context={projectId:'project',requirementId:'requirement',featureId:'feature'};
 const pending=cliProposal({root,artifactRoot:root,llm:{executable:'codex'},terminal,onTerminal:event=>{
  opened=event;
  void(async()=>{
   // Ordinary streaming writes must not publish an empty/partial JSON proposal.
   await writeFile(join(directory,'proposal.json'),'{"status":');
   await new Promise<void>(resolve=>setImmediate(resolve));
   await appendFile(join(directory,'proposal.json'),'"needs_input","questions":["Missing expected value"]}');
   await writeFile(join(directory,'proposal.ready'),'');
  })();
 }},'source-preserving task',{terminalContext:context});
 assert.deepEqual((await pending).proposal,{status:'needs_input',questions:['Missing expected value']});
 assert.deepEqual(opened,{...context,terminalId:'controlled-session',workspaceRef:directory});
 assert.equal(command.file,'codex');assert(command.args.includes('--no-alt-screen'));assert(!command.args.includes('exec'));
 assert.match(await readFile(join(directory,'task.md'),'utf8'),/source-preserving task/);
 assert.equal(listener,undefined);assert.equal(closed,false,'successful CLI remains available to the user');assert.equal(terminal.hasSession('controlled-session'),true);
});

test('closing the interactive terminal rejects the pending generation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const sessions=new Set<string>();const terminal:TerminalRuntimePort={async create(){sessions.add('cancel-session');return{id:'cancel-session'};},input(){},resize(){},hasSession(id){return sessions.has(id);},subscribe(_id,callback){queueMicrotask(()=>{sessions.delete('cancel-session');callback({type:'terminal.exited',exitCode:130});});return()=>{};},closeTerminal(id){sessions.delete(id);},close(){sessions.clear();}};
 await assert.rejects(cliProposal({root,artifactRoot:root,llm:{executable:'codex'},terminal},'task',{}),(error:any)=>error.code==='LLM_CLI_EXITED');
});

test('workflow Agent CLI profile supplies its executable, argv, prompt and saved Skill to a proposal run',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-agent-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let directory='',command:any,inputText='',inputCalls:string[]=[];const terminal:TerminalRuntimePort={async create(input){directory=input.workspaceRef;command=input.command;return{id:'agent-profile-session'};},input(_id,data){inputText+=data;inputCalls.push(data);},resize(){},hasSession(){return true;},subscribe(_id,listener){queueMicrotask(()=>listener({type:'terminal.output',data:'interactive prompt ready'}));return()=>{};},closeTerminal(){},close(){}};
 const agent={id:'agent',name:'System Designer',prompt:'Use the approved system design constraints.',cliCommand:{id:'cli',name:'Configured CLI',executable:'configured-cli',args:['--interactive','--model','local-model']},skill:{id:'skill',name:'Architecture rules',instructions:'Keep migrations transactional.'}};
 const request={terminalContext:{projectId:'project',requirementId:'requirement',featureId:'feature'},gherkin:'Feature: approved Gherkin context',context:{providedContext:'DATABASE_CONTEXT_MARKER'}};
 const result=await cliProposal({root,artifactRoot:root,terminal,onTerminal:event=>{
  void(async()=>{await writeFile(join(event.workspaceRef,'proposal.json'),JSON.stringify({status:'needs_input',questions:['Confirm the target database']}));await writeFile(join(event.workspaceRef,'proposal.ready'),'');})();
 }},'Generate an SD proposal.',request,undefined,agent);
 assert.deepEqual(result.proposal,{status:'needs_input',questions:['Confirm the target database']});
 assert.equal(command.file,'configured-cli');assert.deepEqual(command.args,['--interactive','--model','local-model']);
 assert.equal(inputCalls.length,2);assert.match(inputCalls[0],/Use the approved system design constraints\./);assert.match(inputCalls[0],/Read task\.md and request\.json/);assert.match(inputCalls[0],/complete stage-specific inputs selected by the workbench/);assert.equal(inputCalls[1],'\r');assert.equal(inputText,inputCalls.join(''));
 const savedRequest=JSON.parse(await readFile(join(directory,'request.json'),'utf8'));assert.equal(savedRequest.gherkin,request.gherkin);assert.equal(savedRequest.context.providedContext,'DATABASE_CONTEXT_MARKER');
 const task=await readFile(join(directory,'task.md'),'utf8');assert.match(task,/Use the approved system design constraints/);assert.match(task,/Read \.agents\/skills\/configured-agent\/SKILL\.md/);
 assert.match(await readFile(join(directory,'.agents/skills/configured-agent/SKILL.md'),'utf8'),/Architecture rules/);
});

test('Codex Agent receives its initial task as a positional prompt and keeps the interactive TUI open',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-codex-initial-prompt-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let directory='',command:any,inputs:string[]=[],closed=false;const terminal:TerminalRuntimePort={async create(input){directory=input.workspaceRef;command=input.command;return{id:'codex-initial-prompt-session'};},input(_id,data){inputs.push(data);},resize(){},hasSession(){return true;},subscribe(_id,listener){queueMicrotask(()=>listener({type:'terminal.output',data:'interactive TUI ready'}));return()=>{};},closeTerminal(){closed=true;},close(){}};
 const agent={id:'codex-agent',name:'Codex',prompt:'Use the approved design.',cliCommand:{id:'codex-cli',name:'Codex CLI',executable:'/usr/local/bin/codex',args:['--no-alt-screen','--no-daemon']},skill:null};
 const result=await cliProposal({root,artifactRoot:root,terminal,onTerminal:event=>{
  void(async()=>{await writeFile(join(event.workspaceRef,'proposal.json'),JSON.stringify({status:'needs_input',questions:['Confirm the target database']}));await writeFile(join(event.workspaceRef,'proposal.ready'),'');})();
 }},'Generate an SD proposal.',{terminalContext:{projectId:'project',requirementId:'requirement',featureId:'feature'},gherkin:'CODEX_APPROVED_GHERKIN',context:{targetDatabase:'CODEX_DATABASE_CONTEXT'}},undefined,agent);
 assert.equal(result.proposal.status,'needs_input');assert.equal(command.file,'/usr/local/bin/codex');assert.deepEqual(command.args.slice(0,2),['--no-alt-screen','--no-daemon']);
 assert.match(command.args.at(-1),/Use the approved design\./);assert.match(command.args.at(-1),/Read task\.md and request\.json/);assert.match(command.args.at(-1),/complete stage-specific inputs selected by the workbench/);assert.deepEqual(inputs,[]);assert.equal(closed,false,'successful Codex TUI remains available to the user');
 const savedRequest=JSON.parse(await readFile(join(directory,'request.json'),'utf8'));assert.equal(savedRequest.gherkin,'CODEX_APPROVED_GHERKIN');assert.equal(savedRequest.context.targetDatabase,'CODEX_DATABASE_CONTEXT');
 assert.match(await readFile(join(directory,'task.md'),'utf8'),/Use the approved design/);
});
