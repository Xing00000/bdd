#!/usr/bin/env node
/** Supervised host: the official SDK owns every Codex thread and tool execution. */
import { Codex } from '@openai/codex-sdk';
import { readJson } from '../packages/contracts/index.mjs';
import { runCodexSdkSession } from '../packages/workstation/codex-sdk-agent.mjs';

const controller=new AbortController();
const cancel=()=>controller.abort(new Error('SDK 派工已取消。'));
process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
try {
  if(process.argv.length!==3)throw Error('Expected one SDK job file');
  await runCodexSdkSession(await readJson(process.argv[2]),{Codex,signal:controller.signal});
} catch(error) {
  // SDK errors include native process stderr. Preserve the real cause for the job log.
  process.stderr.write(`[Codex SDK] ${error.code??'CODEX_SDK_FAILED'}: ${error.message??String(error)}\n`);
  process.exitCode=1;
} finally {process.off('SIGTERM',cancel);process.off('SIGINT',cancel);}
