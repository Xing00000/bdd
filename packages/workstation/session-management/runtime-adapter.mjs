/** Official Codex SDK adapter for a single Session v2 BotTask turn.
 * The SDK (not this wrapper) owns reasoning, MCP calls and tool execution.
 * Copilot/Kiro ACP is the Responses inference provider and receives no MCP server.
 */
import {mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireThat as ok} from './contracts.mjs';

const scopedMcp=fileURLToPath(new URL('../../../scripts/mcp-session-node.mjs',import.meta.url));
const importantEnv=['PATH','HOME','USER','USERPROFILE','SYSTEMROOT','TMPDIR','LANG','TERM'];

export async function runNativeCodexTurn({
  home,worktree,capabilityFile,chatSettings,model,nativeId,prompt,signal,onEvent=()=>{}
}) {
  const [{Codex},{createChatProvider}]=await Promise.all([
    import('@openai/codex-sdk'),
    import('../../../dist/src/adapters/runtime/chat-provider.js')
  ]);
  ok(chatSettings?.codexExecutable,'SDK_CONFIGURATION_REQUIRED','Codex executable is not configured',503);
  ok(typeof prompt==='string'&&prompt.length>0&&Buffer.byteLength(prompt)<=65536,
    'SDK_PROMPT_LIMIT','Bot turn prompt is missing or exceeds 64 KiB',422);
  const provider=await createChatProvider(worktree,'codex');
  const snapshot={...chatSettings,model:model==='auto'?chatSettings.model:model};
  const registration=provider.register(snapshot);
  const ctrl=new AbortController();
  const timeoutMs=Math.max(1000,Math.min(Number(chatSettings.timeoutMs)||300000,1800000));
  const deadline=setTimeout(()=>ctrl.abort(Error('Native Codex turn exceeded configured timeout')),timeoutMs);
  const abort=()=>ctrl.abort(signal.reason);
  if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
  const directory=path.join(home,'session-execution','codex-home');
  let completed=false,started=false,lastMessage='',errorEvent,threadId=nativeId??null;
  try{
    await mkdir(directory,{recursive:true,mode:0o700});
    const env={};
    for(const key of importantEnv)if(process.env[key])env[key]=process.env[key];
    env.CODEX_HOME=directory;
    env.WB_CODEX_PROVIDER_TOKEN=registration.token;
    const client=new Codex({
      codexPathOverride:chatSettings.codexExecutable,
      env,
      config:{
        model_provider:'workstation_copilot',
        model_providers:{workstation_copilot:{
          name:'ACP model inference',base_url:provider.url,wire_api:'responses',
          requires_openai_auth:false,env_key:'WB_CODEX_PROVIDER_TOKEN',
          supports_websockets:false,request_max_retries:0,stream_max_retries:0
        }},
        mcp_servers:{
          session_node:{command:process.execPath,args:[scopedMcp,capabilityFile],enabled:true,required:true}
        },
        developer_instructions:'Use the scoped session_node MCP for task context and CLI delegation. Never run Git, including read-only git. Only the workstation may checkpoint at feature creation or human acceptance. Never fabricate evidence or approval. Return exactly the requested JSON turn disposition.',
        shell_environment_policy:{exclude:['WB_CODEX_PROVIDER_TOKEN']},
        features:{code_mode:false,code_mode_host:false,code_mode_only:false,code_mode_tool_search:false,incremental_tools:false,apps:false,plugins:false,skill_search:false,tool_suggest:false,multi_agent:false,browser_use:false,computer_use:false,image_generation:false,shell_snapshot:false}
      }
    });
    const thread=nativeId
      ? client.resumeThread(nativeId,{model:snapshot.model,workingDirectory:worktree,skipGitRepoCheck:true,sandboxMode:'workspace-write',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled'})
      : client.startThread({model:snapshot.model,workingDirectory:worktree,skipGitRepoCheck:true,sandboxMode:'workspace-write',approvalPolicy:'never',networkAccessEnabled:false,webSearchMode:'disabled'});
    registration.activate(ctrl.signal);
    const {events}=await thread.runStreamed(prompt,{signal:ctrl.signal});
    for await(const event of events){
      onEvent(event);
      if(event.type==='thread.started'){started=true;threadId=thread.id??event.thread_id;}
      if(event.type==='item.completed'&&event.item?.type==='agent_message')lastMessage=event.item.text;
      if(event.type==='turn.completed')completed=true;
      if(event.type==='turn.failed'||event.type==='error')errorEvent=event.error?.message??event.message??'Native Codex turn failed';
    }
    ok(!errorEvent,'SDK_TURN_FAILED',errorEvent??'SDK turn failed',422);
    ok(started||Boolean(nativeId),'SDK_THREAD_MISSING','SDK did not prove a thread was started',422);
    ok(completed&&typeof thread.id==='string'&&thread.id,'SDK_TURN_INCOMPLETE','SDK did not return turn.completed',422);
    ok(typeof lastMessage==='string'&&lastMessage.trim(),'SDK_OUTPUT_MISSING','SDK did not return a final structured disposition',422);
    const final=lastMessage.trim();
    // Do not repair or guess malformed JSON after tools have already executed.
    let disposition;
    try{disposition=JSON.parse(final);}catch{ok(false,'SDK_OUTPUT_FORMAT','Bot output is not strict JSON',422);}
    ok(disposition&&typeof disposition==='object'&&!Array.isArray(disposition),'SDK_OUTPUT_FORMAT','Invalid Bot disposition',422);
    if(disposition.kind==='OUTPUT'){
      ok(Object.keys(disposition).sort().join(',')==='data,kind'&&disposition.data&&typeof disposition.data==='object'&&!Array.isArray(disposition.data),'SDK_OUTPUT_FORMAT','Invalid OUTPUT disposition',422);
    }else if(disposition.kind==='YIELD'){
      ok(Object.keys(disposition).sort().join(',')==='kind,reason'&&typeof disposition.reason==='string'&&disposition.reason.length<=2000,'SDK_OUTPUT_FORMAT','Invalid YIELD disposition',422);
    }else ok(false,'SDK_OUTPUT_FORMAT','Unknown turn disposition',422);
    return {threadId:thread.id,disposition};
  }finally{
    clearTimeout(deadline);
    signal?.removeEventListener('abort',abort);
    registration.deactivate();
    registration.close();
    await provider.close();
  }
}
