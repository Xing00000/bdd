<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue';
import {api,errorText} from './api';

type CliCommand={id:string;name:string;executable:string;args:string[]};
type Skill={id:string;name:string;instructions:string};
type Agent={id:string;name:string;cliCommandId:string;skillId:string|null;prompt:string;cliCommand:CliCommand;skill:Skill|null};
const emit=defineEmits<{saved:[]}>();
const commands=ref<CliCommand[]>([]),skills=ref<Skill[]>([]),agents=ref<Agent[]>([]),loading=ref(true),busy=ref(''),error=ref('');
const commandForm=ref(false),skillForm=ref(false),agentForm=ref(false);
const commandDraft=reactive({id:'',name:'',executable:'',args:'[]'});
const skillDraft=reactive({id:'',name:'',instructions:''});
const agentDraft=reactive({id:'',name:'',cliCommandId:'',skillId:'',prompt:''});

async function refresh(){
 loading.value=true;
 try{const result=await api('/llm-settings');commands.value=result.cliCommands;skills.value=result.skills;agents.value=result.agents;}
 catch(e){error.value=errorText(e);}
 finally{loading.value=false;}
}
async function perform(name:string,fn:()=>Promise<void>){
 if(busy.value)return;busy.value=name;error.value='';
 try{await fn();await refresh();emit('saved');}
 catch(e){error.value=errorText(e);}
 finally{busy.value='';}
}
function resetCommand(){Object.assign(commandDraft,{id:'',name:'',executable:'',args:'[]'});commandForm.value=false;}
function startCommand(){if(commandForm.value){resetCommand();return;}resetCommand();commandForm.value=true;}
function editCommand(item:CliCommand){Object.assign(commandDraft,{id:item.id,name:item.name,executable:item.executable,args:JSON.stringify(item.args,null,2)});commandForm.value=true;}
async function saveCommand(){
 await perform('command',async()=>{let args:unknown;try{args=JSON.parse(commandDraft.args);}catch{throw Error('CLI 參數必須是有效 JSON 陣列。');}if(!Array.isArray(args)||args.some(value=>typeof value!=='string'))throw Error('CLI 參數必須是字串陣列。');
  await api(commandDraft.id?`/llm-settings/cli-commands/${encodeURIComponent(commandDraft.id)}`:'/llm-settings/cli-commands',{name:commandDraft.name,executable:commandDraft.executable,args},commandDraft.id?'PUT':'POST');resetCommand();});
}
async function deleteCommand(item:CliCommand){if(!window.confirm(`刪除 CLI 指令「${item.name}」？`))return;await perform('delete-command',async()=>{await api(`/llm-settings/cli-commands/${encodeURIComponent(item.id)}`,undefined,'DELETE');});}
function resetSkill(){Object.assign(skillDraft,{id:'',name:'',instructions:''});skillForm.value=false;}
function startSkill(){if(skillForm.value){resetSkill();return;}resetSkill();skillForm.value=true;}
function editSkill(item:Skill){Object.assign(skillDraft,item);skillForm.value=true;}
async function saveSkill(){await perform('skill',async()=>{await api(skillDraft.id?`/llm-settings/skills/${encodeURIComponent(skillDraft.id)}`:'/llm-settings/skills',{name:skillDraft.name,instructions:skillDraft.instructions},skillDraft.id?'PUT':'POST');resetSkill();});}
async function deleteSkill(item:Skill){if(!window.confirm(`刪除 Skill「${item.name}」？`))return;await perform('delete-skill',async()=>{await api(`/llm-settings/skills/${encodeURIComponent(item.id)}`,undefined,'DELETE');});}
function resetAgent(){Object.assign(agentDraft,{id:'',name:'',cliCommandId:commands.value[0]?.id??'',skillId:skills.value[0]?.id??'',prompt:''});agentForm.value=false;}
function editAgent(item:Agent){Object.assign(agentDraft,{id:item.id,name:item.name,cliCommandId:item.cliCommandId,skillId:item.skillId??'',prompt:item.prompt});agentForm.value=true;}
function startAgent(){if(agentForm.value){resetAgent();return;}resetAgent();agentForm.value=true;}
async function saveAgent(){await perform('agent',async()=>{await api(agentDraft.id?`/llm-settings/agents/${encodeURIComponent(agentDraft.id)}`:'/llm-settings/agents',{name:agentDraft.name,cliCommandId:agentDraft.cliCommandId,skillId:agentDraft.skillId||null,prompt:agentDraft.prompt},agentDraft.id?'PUT':'POST');resetAgent();});}
async function deleteAgent(item:Agent){if(!window.confirm(`刪除 Agent「${item.name}」？`))return;await perform('delete-agent',async()=>{await api(`/llm-settings/agents/${encodeURIComponent(item.id)}`,undefined,'DELETE');});}
onMounted(refresh);
</script>

<template>
 <div class="llm-settings-page">
  <div class="page-header compact"><div><span class="eyebrow">LOCAL CLI / SKILLS / AGENTS</span><h1>LLM 設定</h1><p>管理 CLI 啟動指令、Skill 與 Agent Prompt；內容儲存在工作台資料庫。</p></div></div>
  <p v-if="error" class="error-text" role="alert">{{error}}</p>
  <div v-if="loading" class="loading-state"><span class="loading-spinner"></span>正在讀取 LLM 設定…</div>
  <template v-else>
   <section class="panel llm-setting-panel">
    <div class="panel-heading"><div><h2>CLI 啟動指令</h2><p>使用執行檔與參數陣列直接啟動，不經 shell。</p></div><button class="button small" :disabled="!!busy" @click="startCommand">{{commandForm?'取消':'＋ 新增'}}</button></div>
    <form v-if="commandForm" class="panel-body llm-setting-form" @submit.prevent="saveCommand">
     <div class="field"><label for="llm-cli-name">顯示名稱</label><input id="llm-cli-name" v-model="commandDraft.name" required maxlength="120" placeholder="例如：Codex CLI"></div>
     <div class="field"><label for="llm-cli-executable">執行檔</label><input id="llm-cli-executable" v-model="commandDraft.executable" required placeholder="例如：codex 或 kiro-cli"></div>
     <div class="field"><label for="llm-cli-args">預設參數（JSON 字串陣列）</label><textarea id="llm-cli-args" v-model="commandDraft.args" class="code-editor short-editor" spellcheck="false" placeholder='["chat"]'></textarea></div>
     <div class="button-row"><button class="button primary small" :disabled="!!busy">保存 CLI 指令</button><button type="button" class="button small" @click="resetCommand">取消</button></div>
    </form>
    <div v-for="item in commands" :key="item.id" class="llm-setting-row"><div><strong>{{item.name}}</strong><code>{{item.executable}} {{item.args.join(' ')}}</code></div><div class="button-row"><button class="button small" :disabled="!!busy" @click="editCommand(item)">編輯</button><button class="button small" :disabled="!!busy" @click="deleteCommand(item)">刪除</button></div></div>
    <p v-if="!commands.length" class="llm-setting-empty">尚未設定 CLI 啟動指令。</p>
   </section>

   <section class="panel llm-setting-panel">
    <div class="panel-heading"><div><h2>Skills</h2><p>Skill 指示會與 Agent Prompt 一起提供給 CLI。</p></div><button class="button small" :disabled="!!busy" @click="startSkill">{{skillForm?'取消':'＋ 新增'}}</button></div>
    <form v-if="skillForm" class="panel-body llm-setting-form" @submit.prevent="saveSkill">
     <div class="field"><label for="llm-skill-name">Skill 名稱</label><input id="llm-skill-name" v-model="skillDraft.name" required maxlength="120" placeholder="例如：BDD 需求檢視"></div>
     <div class="field"><label for="llm-skill-instructions">Skill 指示</label><textarea id="llm-skill-instructions" v-model="skillDraft.instructions" required class="code-editor" spellcheck="false" placeholder="寫下此 Skill 要求 Agent 遵循的工作方式"></textarea></div>
     <div class="button-row"><button class="button primary small" :disabled="!!busy">保存 Skill</button><button type="button" class="button small" @click="resetSkill">取消</button></div>
    </form>
    <div v-for="item in skills" :key="item.id" class="llm-setting-row"><div><strong>{{item.name}}</strong><p>{{item.instructions}}</p></div><div class="button-row"><button class="button small" :disabled="!!busy" @click="editSkill(item)">編輯</button><button class="button small" :disabled="!!busy" @click="deleteSkill(item)">刪除</button></div></div>
    <p v-if="!skills.length" class="llm-setting-empty">尚未設定 Skill。</p>
   </section>

   <section class="panel llm-setting-panel">
    <div class="panel-heading"><div><h2>Agent 設定</h2><p>每個 Agent 指定一個 CLI、一個 Skill 與一份預設 Prompt。</p></div><button class="button small" :disabled="!!busy||!commands.length" @click="startAgent">{{agentForm?'取消':'＋ 新增'}}</button></div>
    <form v-if="agentForm" class="panel-body llm-setting-form" @submit.prevent="saveAgent">
     <div class="field"><label for="llm-agent-name">Agent 名稱</label><input id="llm-agent-name" v-model="agentDraft.name" required maxlength="120" placeholder="例如：需求確認 Agent"></div>
     <div class="field"><label for="llm-agent-cli">CLI 啟動指令</label><select id="llm-agent-cli" v-model="agentDraft.cliCommandId" required><option v-for="item in commands" :key="item.id" :value="item.id">{{item.name}} · {{item.executable}}</option></select></div>
     <div class="field"><label for="llm-agent-skill">Skill</label><select id="llm-agent-skill" v-model="agentDraft.skillId"><option value="">不使用 Skill</option><option v-for="item in skills" :key="item.id" :value="item.id">{{item.name}}</option></select></div>
     <div class="field"><label for="llm-agent-prompt">預設 Prompt</label><textarea id="llm-agent-prompt" v-model="agentDraft.prompt" required class="code-editor" spellcheck="false" placeholder="啟動 Agent 時預先傳入的指令"></textarea></div>
     <div class="button-row"><button class="button primary small" :disabled="!!busy">保存 Agent</button><button type="button" class="button small" @click="resetAgent">取消</button></div>
    </form>
    <div v-for="item in agents" :key="item.id" class="llm-setting-row"><div><strong>{{item.name}}</strong><code>{{item.cliCommand.name}} · {{item.skill?.name??'不使用 Skill'}}</code><p>{{item.prompt}}</p></div><div class="button-row"><button class="button small" :disabled="!!busy" @click="editAgent(item)">編輯</button><button class="button small" :disabled="!!busy" @click="deleteAgent(item)">刪除</button></div></div>
    <p v-if="!agents.length" class="llm-setting-empty">尚未設定 Agent。</p>
   </section>
  </template>
 </div>
</template>

<style scoped>
.llm-settings-page{display:grid;gap:18px}.llm-setting-panel>.panel-heading{align-items:center}.llm-setting-panel>.panel-heading p{margin-top:3px;color:var(--muted);font-size:10px}.llm-setting-form{display:grid;gap:12px;border-bottom:1px solid var(--line)}.llm-setting-form .field{margin:0}.llm-setting-form select,.llm-setting-form input{width:100%;margin-top:4px}.llm-setting-form .code-editor{min-height:90px}.llm-setting-form .short-editor{min-height:64px}.llm-setting-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 18px;border-bottom:1px solid var(--line)}.llm-setting-row:last-of-type{border-bottom:0}.llm-setting-row>div:first-child{display:grid;gap:4px;min-width:0}.llm-setting-row strong{font-size:11px}.llm-setting-row code{color:#6e816d;font:10px Consolas,monospace;overflow-wrap:anywhere}.llm-setting-row p{max-width:900px;color:var(--muted);font-size:10px;white-space:pre-wrap;overflow-wrap:anywhere}.llm-setting-row .button-row{flex:0 0 auto}.llm-setting-empty{padding:14px 18px;color:var(--muted);font-size:10px}@media(max-width:650px){.llm-setting-row{align-items:flex-start;flex-direction:column}.llm-setting-row .button-row{align-self:flex-end}}
</style>
