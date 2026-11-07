import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type {ChatSettings} from '../../ports/chat.ts';
import {automaticChatModel} from '../../domain/chat.ts';

export function defaultKiroExecutable():string{
 const localBin=path.join(os.homedir(),'.local','bin','kiro-cli');
 return existsSync(localBin)?localBin:'kiro-cli';
}

export function defaultChatSettings():ChatSettings{
 const require=createRequire(import.meta.url);
 const loader=path.join(path.dirname(require.resolve('@github/copilot/package.json')),'npm-loader.js');
 const codex=path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
 return {codexExecutable:codex,acpProvider:'copilot',copilotExecutable:process.execPath,copilotArgs:[loader],kiroExecutable:defaultKiroExecutable(),kiroArgs:[],model:automaticChatModel,timeoutMs:120000};
}
