#!/usr/bin/env node
import readline from 'node:readline';
import {readFile} from 'node:fs/promises';
import {taskRpc} from '../packages/workstation/agent-task.mjs';
const bundle=JSON.parse(await readFile(process.argv[2],'utf8'));
for await (const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})) {
  let response;
  try {response=taskRpc(bundle,JSON.parse(line));}
  catch {response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
  if(response)process.stdout.write(JSON.stringify(response)+'\n');
}
