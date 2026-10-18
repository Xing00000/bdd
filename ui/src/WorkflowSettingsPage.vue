<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {api,errorText} from './api';

type Agent={id:string;name:string;cliCommand:{name:string}};
type Stage={key:string;label:string;agentIds:string[]};
const emit=defineEmits<{saved:[]}>();
const agents=ref<Agent[]>([]),stages=ref<Stage[]>([]),loading=ref(true),busy=ref(false),error=ref(''),notice=ref('');

async function refresh(){
 loading.value=true;error.value='';
 try{const result=await api('/workflow-settings');agents.value=result.agents;stages.value=result.stages;}
 catch(cause){error.value=errorText(cause);}
 finally{loading.value=false;}
}
function toggle(stage:Stage,agentId:string,event:Event){
 const checked=(event.target as HTMLInputElement).checked;
 stage.agentIds=checked?[...stage.agentIds,agentId]:stage.agentIds.filter(id=>id!==agentId);
}
async function save(){
 if(busy.value)return;busy.value=true;error.value='';notice.value='';
 try{
  const assignments=Object.fromEntries(stages.value.map(stage=>[stage.key,stage.agentIds]));
  const result=await api('/workflow-settings',{assignments},'PUT');
  stages.value=result.stages;agents.value=result.agents;notice.value='流程設定已保存。各階段會顯示已指派的 Agent。';emit('saved');
 }catch(cause){error.value=errorText(cause);}
 finally{busy.value=false;}
}
onMounted(refresh);
</script>

<template>
 <div class="workflow-settings-page">
  <div class="page-header compact"><div><span class="eyebrow">WORKFLOW AGENTS</span><h1>流程設定</h1><p>為每個可編輯階段指派一個或多個 Agent。保存後，Agent 按鈕只會出現在該階段可編輯時。</p></div></div>
  <p v-if="error" class="error-text" role="alert">{{error}}</p>
  <p v-if="notice" class="notice" role="status">{{notice}}</p>
  <div v-if="loading" class="loading-state"><span class="loading-spinner"></span>正在讀取流程設定…</div>
  <template v-else>
   <section v-for="(stage,index) in stages" :key="stage.key" class="panel workflow-setting-stage">
    <div class="panel-heading"><div><span class="eyebrow">{{String(index+1).padStart(2,'0')}} · {{stage.key}}</span><h2>{{stage.label}}</h2></div><span class="tag">{{stage.agentIds.length}} 個 Agent</span></div>
    <div v-if="agents.length" class="workflow-agent-options">
     <label v-for="agent in agents" :key="agent.id" class="workflow-agent-option">
      <input type="checkbox" :checked="stage.agentIds.includes(agent.id)" :disabled="busy" :aria-label="stage.label+' · '+agent.name" @change="toggle(stage,agent.id,$event)">
      <span><strong>{{agent.name}}</strong><small>{{agent.cliCommand.name}}</small></span>
     </label>
    </div>
    <p v-else class="empty-small">尚未建立 Agent。請先在 <a href="/llm-settings">LLM 設定</a>建立 CLI、Skill 與 Agent。</p>
   </section>
   <section class="panel workflow-setting-readonly"><div><span class="eyebrow">05 · VERIFICATION</span><h2>驗證報告</h2><p>驗證報告是唯讀結果，不執行 Agent 操作。</p></div><span class="tag">唯讀</span></section>
   <div class="workflow-settings-footer"><span class="muted small-text">同一個 Agent 可指派到多個階段；每個階段可選多個 Agent。</span><button class="button primary" data-testid="save-workflow-settings" :disabled="busy" @click="save">{{busy?'保存中…':'保存流程設定'}}</button></div>
  </template>
 </div>
</template>

<style scoped>
.workflow-settings-page{display:grid;gap:14px}.workflow-setting-stage>.panel-heading{align-items:center}.workflow-setting-stage>.panel-heading p{margin-top:4px;color:var(--muted);font-size:10px}.workflow-agent-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;background:var(--line)}.workflow-agent-option{display:flex;align-items:center;gap:10px;min-width:0;padding:12px 16px;background:var(--surface);cursor:pointer}.workflow-agent-option input{flex:0 0 auto}.workflow-agent-option>span{display:grid;gap:3px;min-width:0}.workflow-agent-option strong{font-size:11px;overflow-wrap:anywhere}.workflow-agent-option small{color:var(--muted);font-size:9px}.workflow-setting-readonly{display:flex;align-items:center;justify-content:space-between;padding:16px 18px}.workflow-setting-readonly p{margin-top:4px;color:var(--muted);font-size:10px}.workflow-settings-footer{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;background:var(--canvas)}@media(max-width:600px){.workflow-settings-footer{align-items:flex-start;flex-direction:column}}
</style>
