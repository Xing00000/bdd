import {createRequire} from 'node:module';
import path from 'node:path';
import type {ChatSettings} from '../../ports/chat.ts';

export function defaultChatSettings():ChatSettings{
 const require=createRequire(import.meta.url);
 const loader=path.join(path.dirname(require.resolve('@github/copilot/package.json')),'npm-loader.js');
 const codex=path.join(path.dirname(require.resolve('@openai/codex/package.json')),'bin/codex.js');
 return {codexExecutable:codex,copilotExecutable:process.execPath,copilotArgs:[loader],model:'auto',timeoutMs:120000};
}
