import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCodexChatRuntime} from '../../src/adapters/runtime/codex-chat.ts';
import {copilotChatPeer} from '../helpers/copilot-chat-peer.ts';

test('installed Codex streams two runtime turns through the local Copilot peer while reusing processes and preserving one history',{timeout:60000},async t=>{
 // The installed Codex binary consumes the actual Responses SSE adapter.
 // Copilot model output is a local protocol fixture, never paid inference.
 const require=createRequire(import.meta.url);
 assert.equal(require('@openai/codex/package.json').version,'0.166.0');
 const loader=path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
 const directory=await mkdtemp(path.join(tmpdir(),'bdd-native-chat-runtime-'));
 const qaHome=path.join(directory,'home'),temporary=path.join(directory,'tmp'),trace=path.join(directory,'codex-spawns.jsonl'),wrapper=path.join(directory,'native-codex.mjs');
 await Promise.all([qaHome,temporary].map(folder=>mkdir(folder)));
 const interpreter=path.isAbsolute(process.execPath)?process.execPath:'/usr/bin/env node';
 await writeFile(wrapper,`#!${interpreter}\n`+`
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const qaHome=${JSON.stringify(qaHome)},temporary=${JSON.stringify(temporary)};
const env={PATH:process.env.PATH,LANG:'C.UTF-8',TMPDIR:temporary,HOME:qaHome,USERPROFILE:qaHome,SYSTEMROOT:process.env.SYSTEMROOT,CODEX_HOME:process.env.CODEX_HOME,WB_CHAT_PROVIDER_TOKEN:process.env.WB_CHAT_PROVIDER_TOKEN,XDG_CONFIG_HOME:qaHome+'/config',XDG_CACHE_HOME:qaHome+'/cache'};
appendFileSync(${JSON.stringify(trace)},JSON.stringify({pid:process.pid,codexHome:env.CODEX_HOME})+'\\n');
const child=spawn(process.execPath,[${JSON.stringify(loader)},...process.argv.slice(2)],{env,stdio:'inherit'});
child.on('error',error=>{process.stderr.write(error.message+'\\n');process.exitCode=1;});
child.on('close',code=>{process.exitCode=code??1;});
`,{mode:0o700});
 const responseText='Local protocol fixture reply through the installed Codex runtime';
 const peer=await copilotChatPeer(directory,{responseText});
 const runtime=await createCodexChatRuntime(path.join(directory,'runtime'));
 t.after(async()=>{try{await runtime.close();}finally{await rm(directory,{recursive:true,force:true});}});
 const settings={codexExecutable:wrapper,copilotExecutable:peer.copilotExecutable,copilotArgs:peer.copilotArgs,model:'protocol-fixture',timeoutMs:20000};
 const firstMarker='first-'+randomUUID(),secondMarker='second-'+randomUUID(),threads:string[]=[],answers:string[]=[],streams:string[][]=[];
 let threadId:string|null=null;
 for(const text of [firstMarker,secondMarker]){
  const deltas:string[]=[];let completed=false;
  const answer=await runtime.reply({roomId:'native-runtime-room',threadId,text,settings,
   onThread:async id=>{threads.push(id);threadId=id;},
   onDelta:delta=>{assert.equal(completed,false,'A delta arrives before the turn resolves');deltas.push(delta);},
  });completed=true;answers.push(answer);streams.push(deltas);
  assert(deltas.length>0,'The actual Codex app-server emits agentMessage deltas');
  assert.equal(deltas.join(''),responseText);assert.equal(answer,responseText);
 }
 assert.equal(threads.length,2);assert.equal(new Set(threads).size,1);assert(threads[0]);
 assert.deepEqual(answers,[responseText,responseText]);assert.equal(streams.length,2);
 const events=(await readFile(peer.tracePath,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const requests=(method:string)=>events.filter(event=>event.type==='request'&&event.method===method);
 assert.equal(events.filter(event=>event.type==='spawn').length,1,'One Copilot protocol server serves both requests');
 assert.equal(requests('connect').length,1);assert.equal(requests('session.create').length,2);
 assert.equal(new Set(requests('session.create').map(event=>event.params.sessionId)).size,2,'Each inference gets an isolated session');
 assert.equal(requests('session.send').length,2,'A normal two-message conversation makes exactly two fixture completions');
 assert.equal(requests('session.delete').length,2,'Both temporary inference sessions are deleted');
 const histories=requests('session.send').map(event=>{
  const start=event.params.prompt.indexOf('\n{');assert(start>=0,'Provider prompt carries structured Codex history');
  return JSON.parse(event.params.prompt.slice(start+1)).input as any[];
 });
 const texts=(input:any[])=>input.filter(item=>item.type==='message').flatMap(item=>item.content.map((part:any)=>({role:item.role,text:part.text})));
 const first=texts(histories[0]),second=texts(histories[1]);
 const occurrences=(items:{role:string;text:string}[],role:string,text:string)=>items.filter(item=>item.role===role).reduce((count,item)=>count+item.text.split(text).length-1,0);
 assert.equal(occurrences(first,'user',firstMarker),1);
 assert.equal(occurrences(first,'assistant',responseText),0);
 assert.equal(occurrences(second,'user',firstMarker),1,'Earlier user text appears once');
 assert.equal(occurrences(second,'assistant',responseText),1,'Earlier assistant text appears once');
 assert.equal(occurrences(second,'user',secondMarker),1,'New user text appears once');
 const position=(text:string)=>second.findIndex(item=>item.text.includes(text));
 assert(position(firstMarker)<position(responseText)&&position(responseText)<position(secondMarker),'Codex preserves conversation order');
 const spawns=(await readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(spawns.length,1,'The same installed Codex app-server handles both turns');
 assert.equal(spawns[0].codexHome,path.join(directory,'runtime','codex'),'Codex has an isolated test home');
 await runtime.close();
});
