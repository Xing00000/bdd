/**
 * Controlled native peers launched by the official Codex SDK. These fixtures
 * exercise SDK dispatch and task persistence; they do not claim model inference.
 */
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';

export async function writeSdkPeer(executable,source) {
  await mkdir(path.dirname(executable),{recursive:true,mode:0o700});
  await writeFile(executable,`#!${process.execPath}
import {readFile as peerReadFile,appendFile as peerAppendFile} from 'node:fs/promises';
import {randomUUID as peerRandomUUID} from 'node:crypto';
import {inspect as peerInspect} from 'node:util';
const peerArgs=process.argv.slice(2);
if(peerArgs[0]!=='exec'||!peerArgs.includes('--experimental-json'))throw Error('Expected official SDK exec streaming');
const peerOption=name=>{const index=peerArgs.indexOf(name);return index<0?undefined:peerArgs[index+1];};
const peerTaskConfig=peerArgs.find(value=>value.startsWith('mcp_servers.workbench_task.args='));
if(!peerTaskConfig)throw Error('Missing task MCP configuration');
const peerTaskArgs=JSON.parse(peerTaskConfig.slice(peerTaskConfig.indexOf('=')+1));
const taskFile=peerTaskArgs.at(-1),cwd=peerOption('--cd')??process.cwd(),model=peerOption('--model');
const {task,artifacts}=JSON.parse(await peerReadFile(taskFile,'utf8'));
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const peerResumeIndex=peerArgs.indexOf('resume'),isResume=peerResumeIndex>=0;
const threadId=isResume?peerArgs[peerResumeIndex+1]:peerRandomUUID();
await peerAppendFile(${JSON.stringify(executable+'.calls.jsonl')},JSON.stringify({taskFile,cwd,prompt,model,threadId,isResume,sdkOriginator:process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE})+'\\n',{mode:0o600});
const emitEvent=event=>process.stdout.write(JSON.stringify(event)+'\\n');
let peerMessageSequence=0;
const emitMessage=text=>emitEvent({type:'item.completed',item:{id:'fixture-message-'+(++peerMessageSequence),type:'agent_message',text:String(text)}});
console.log=(...values)=>emitMessage(values.map(value=>typeof value==='string'?value:peerInspect(value)).join(' '));
emitEvent({type:'thread.started',thread_id:threadId});
emitEvent({type:'turn.started'});
${source}
emitEvent({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}});
`,{mode:0o755});
  return executable;
}

export async function configureSdkPeer({home,directory,source,name='codex-peer.mjs'}) {
  const executable=await writeSdkPeer(path.join(directory,name),source);
  await mkdir(home,{recursive:true,mode:0o700});
  const database=new DatabaseSync(path.join(home,'metadata.sqlite'));
  try {
    database.exec('CREATE TABLE IF NOT EXISTS chat_settings(id INTEGER PRIMARY KEY,value_json TEXT NOT NULL)');
    const current=database.prepare('SELECT value_json FROM chat_settings WHERE id=1').get();
    const settings=current?JSON.parse(current.value_json):{copilotExecutable:'not-invoked-by-controlled-sdk-peer',copilotArgs:[],model:'fixture-model',timeoutMs:120000};
    database.prepare('INSERT INTO chat_settings(id,value_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json').run(JSON.stringify({...settings,codexExecutable:executable}));
  } finally {database.close();}
  return executable;
}

export async function readSdkPeerCalls(executable) {
  try {return (await readFile(executable+'.calls.jsonl','utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
}
