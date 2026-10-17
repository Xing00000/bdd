import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cliProposal} from '../../src/adapters/generation/cli.ts';
import type {TerminalRuntimePort} from '../../src/ports/runtime.ts';

test('terminal proposal opens the scoped interactive command and consumes an actual file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-proposal-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let directory='',command:any,opened:any,listener:any,closed=false;
 const terminal:TerminalRuntimePort={async create(input){directory=input.workspaceRef;command=input.command;return {id:'controlled-session'};},input(){},resize(){},subscribe(_id,callback){listener=callback;return()=>{listener=undefined;};},closeTerminal(){closed=true;},close(){}};
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
 assert.equal(listener,undefined);assert.equal(closed,false,'successful CLI remains available to the user');
});

test('closing the interactive terminal rejects the pending generation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'terminal-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const terminal:TerminalRuntimePort={async create(){return{id:'cancel-session'};},input(){},resize(){},subscribe(_id,callback){queueMicrotask(()=>callback({type:'terminal.exited',exitCode:130}));return()=>{};},closeTerminal(){},close(){}};
 await assert.rejects(cliProposal({root,artifactRoot:root,llm:{executable:'codex'},terminal},'task',{}),(error:any)=>error.code==='LLM_CLI_EXITED');
});
