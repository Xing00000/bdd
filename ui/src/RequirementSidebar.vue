<script setup lang="ts">
import {reactive,ref,watch} from 'vue';
import {workflowStageOrder} from '../../src/domain/workflow-agent-stages.ts';
const props=defineProps<{requirements:any[];projects:any[];browserRecordings:any[];browserRecordingId:string;requirementId:string;featureId:string;view:string;workflowStage:string}>();
const emit=defineEmits<{navigate:[path:string];createRequirement:[];createFeature:[requirementId:string]}>();
const workflowStages=[{key:'GHERKIN',label:'需求確認'},{key:'SD',label:'系統設計'},{key:'TESTS',label:'測試情境'},{key:'IMPLEMENTATION',label:'程式開發'},{key:'VERIFICATION',label:'驗證報告'}];
const selectedFeatures=reactive<Record<string,string>>({});
const expandedTool=ref<'browser'|'terminal'|''>('');
const featureSelects=new Map<string,HTMLSelectElement>();
watch(()=>[props.requirementId,props.featureId] as const,([id,feature])=>{if(id&&feature)selectedFeatures[id]=feature;},{immediate:true});
watch(()=>props.view,view=>{if(view==='browser-recorder'||view==='terminal')expandedTool.value=view==='browser-recorder'?'browser':'terminal';},{immediate:true});
const featureFor=(r:any)=>selectedFeatures[r.id]??(props.requirementId===r.id&&r.features.some((f:any)=>f.id===props.featureId)?props.featureId:r.features[0]?.id??'');
function stageStatus(r:any,step:any){const feature=r.features.find((item:any)=>item.id===featureFor(r));const current=workflowStageOrder.findIndex(stage=>stage===feature?.stage);const target=workflowStageOrder.findIndex(stage=>stage===step.key);if(current>target)return {kind:'complete',label:'已完成'};if(current===target)return {kind:'current',label:'進行中'};return {kind:'upcoming',label:'尚未開始'};}
function bindFeatureSelect(id:string,element:Element|null){if(element instanceof HTMLSelectElement)featureSelects.set(id,element);else featureSelects.delete(id);}
function chooseFeature(r:any,event:Event){const feature=(event.target as HTMLSelectElement).value;selectedFeatures[r.id]=feature;emit('navigate',href(r.id,feature,r.id===props.requirementId?props.workflowStage:'GHERKIN'));}
function navigateStage(r:any,step:any){const feature=featureSelects.get(r.id)?.value||featureFor(r);emit('navigate',href(r.id,feature,step.key));}
function toggleTool(tool:'browser'|'terminal'){expandedTool.value=expandedTool.value===tool?'':tool;}
function openProjectTool(project:any,tool:'terminal'){emit('navigate',`/projects/${encodeURIComponent(project.id)}/${tool}`);}
function openBrowserRecorder(){emit('navigate','/browser-recorder');}
function recordingName(recording:any){return String(recording.fileName??recording.id).replace(/\.spec\.ts$/,'');}
const href=(id:string,feature?:string,stage='GHERKIN')=>{const query=new URLSearchParams();if(feature)query.set('featureId',feature);query.set('workflowStage',stage);return `/requirements/${encodeURIComponent(id)}?${query}`;};
</script>
<template>
 <aside class="sidebar requirement-sidebar" data-testid="requirement-sidebar" aria-label="需求工作台固定選單">
  <a class="brand" href="/requirements" @click.prevent="emit('navigate','/requirements')"><span class="brand-mark">b.</span><span><strong>需求工作台</strong><small>BDD WORKBENCH</small></span></a>
  <nav class="requirement-navigation" aria-label="需求導覽">
   <div class="sidebar-section"><a href="/requirements" @click.prevent="emit('navigate','/requirements')">需求</a><button aria-label="新增需求" title="新增需求" @click="emit('createRequirement')">＋</button></div>
   <div v-if="!requirements.length" class="sidebar-empty">尚無需求，按 ＋ 建立。</div>
   <details v-for="r in requirements" :key="r.id" open class="sidebar-requirement" :data-testid="'sidebar-requirement-'+r.id">
    <summary><a :href="href(r.id)" :aria-current="requirementId===r.id?'page':undefined" @click.stop.prevent="emit('navigate',href(r.id))">{{r.requirementKey}}</a><span>{{r.features.length}}</span></summary>
    <div class="sidebar-workflow">
     <div class="sidebar-feature-row"><select :ref="element=>bindFeatureSelect(r.id,element as Element|null)" :data-testid="requirementId===r.id?'feature-select':'feature-select-'+r.id" :aria-label="r.requirementKey+' 的 Gherkin'" :value="featureFor(r)" :disabled="!r.features.length" @change="chooseFeature(r,$event)"><option v-for="f in r.features" :key="f.id" :value="f.id">{{f.featureKey}}</option></select><button type="button" :aria-label="'為 '+r.requirementKey+' 新增 Gherkin'" title="新增 Gherkin" @click="emit('createFeature',r.id)">＋</button></div>
     <nav class="sidebar-stage-list" :aria-label="r.requirementKey+' 流程階段'"><a v-for="(step,index) in workflowStages" :key="step.key" class="sidebar-stage" :href="href(r.id,featureFor(r),step.key)" :class="{active:requirementId===r.id&&workflowStage===step.key}" :aria-current="requirementId===r.id&&workflowStage===step.key?'page':undefined" @click.prevent="navigateStage(r,step)"><span class="stage-number">{{String(index+1).padStart(2,'0')}}</span><span>{{step.label}}</span><span class="stage-status-icon" :class="'is-'+stageStatus(r,step).kind" :aria-label="stageStatus(r,step).label" :title="stageStatus(r,step).label" role="img">{{stageStatus(r,step).kind==='complete'?'✓':stageStatus(r,step).kind==='current'?'●':'○'}}</span></a><span v-if="!r.features.length" class="sidebar-stage-empty">先新增 Gherkin</span></nav>
    </div>
   </details>
  </nav>
  <section class="sidebar-tools" aria-label="測試工具">
   <h2>測試工具</h2>
   <button type="button" class="sidebar-tool" :class="{active:view==='browser-recorder'}" :aria-expanded="view==='browser-recorder'" aria-controls="browser-recording-list" data-testid="sidebar-browser" @click="openBrowserRecorder"><span aria-hidden="true">▣</span>瀏覽器錄製</button>
   <div id="browser-recording-list" class="sidebar-workspace-choices" aria-label="已保存的瀏覽器錄製">
    <button v-for="recording in browserRecordings" :key="recording.id" type="button" :class="{'saved-recording-active':browserRecordingId===recording.id}" :title="recordingName(recording)" @click="emit('navigate',`/browser-recorder/${encodeURIComponent(recording.id)}`)">{{recordingName(recording)}}</button>
   </div>
   <button type="button" class="sidebar-tool" :class="{active:view==='terminal'}" :aria-expanded="expandedTool==='terminal'" aria-controls="terminal-workspace-choices" data-testid="sidebar-terminal" @click="toggleTool('terminal')"><span aria-hidden="true">⌘</span>Terminal</button>
   <div v-show="expandedTool==='terminal'" id="terminal-workspace-choices" class="sidebar-workspace-choices" aria-label="選擇 Terminal 工作區">
    <button v-for="workspace in projects" :key="workspace.id" type="button" @click="openProjectTool(workspace,'terminal')">{{workspace.name}}</button>
    <p v-if="!projects.length">尚無工作區</p>
   </div>
  </section>
  <section class="sidebar-tools" aria-label="工作台設定">
   <h2>工作台設定</h2>
   <button type="button" class="sidebar-tool" :class="{active:view==='llm-settings'}" data-testid="sidebar-llm-settings" @click="emit('navigate','/llm-settings')"><span aria-hidden="true">⚙</span>LLM 設定</button>
   <button type="button" class="sidebar-tool" :class="{active:view==='workflow-settings'}" data-testid="sidebar-workflow-settings" @click="emit('navigate','/workflow-settings')"><span aria-hidden="true">⇄</span>流程設定</button>
  </section>
 </aside>
</template>
<style scoped>
.requirement-sidebar{padding:24px 14px 16px;overflow:hidden}.brand{padding:4px 10px 28px}.requirement-navigation{min-height:0;overflow-y:auto;flex:1}.sidebar-section{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px}.sidebar-section>a{color:#d9ece0;text-decoration:none}.sidebar-section>button{color:inherit;background:transparent;border:1px solid #496856;border-radius:4px;width:28px;height:28px}.sidebar-empty{padding:16px 10px;font-size:12px;line-height:1.7}.sidebar-requirement{margin:4px 0}.sidebar-requirement>summary{display:list-item;padding:10px 6px 10px 10px;font-size:12px;color:#a9c2b2}.sidebar-requirement>summary>a{color:#e4f1e7;text-decoration:none;overflow-wrap:anywhere}.sidebar-requirement>summary>span{float:right;font-size:10px;margin-left:8px}.sidebar-workflow{padding:2px 0 8px 7px}.sidebar-feature-row{display:flex;gap:5px;padding:2px 5px 7px}.sidebar-feature-row select{padding:5px 7px;font-size:10px;color:#d9e7dc;background:#203f32;border-color:#345642}.sidebar-feature-row button{flex:0 0 28px;color:#d9e7dc;background:#203f32;border:1px solid #345642;border-radius:4px}.sidebar-stage-list{display:grid;gap:2px}.sidebar-stage{display:flex;align-items:center;gap:8px;padding:7px 9px;color:#bfd2c4;font-size:10px;text-decoration:none;border-radius:4px}.sidebar-stage:hover,.sidebar-stage.active{background:#315a40;color:#fff}.stage-number{font:9px Consolas,monospace;color:#9fbea9}.stage-status-icon{width:14px;margin-left:auto;text-align:center;font:12px/1 Consolas,monospace}.stage-status-icon.is-complete{color:#70d28a}.stage-status-icon.is-current{color:#e4bc63;font-size:10px}.stage-status-icon.is-upcoming{color:#627d6b;font-size:10px}.sidebar-stage-empty{padding:5px 9px;color:#8da997;font-size:9px}.sidebar-tools{display:grid;gap:2px;flex:0 0 auto;border-top:1px solid #345642;padding-top:10px}.sidebar-tools h2{padding:4px 9px;color:#91ad9b;font-size:10px;font-weight:600;letter-spacing:.3px}.sidebar-tool{display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:0;border-radius:4px;background:transparent;color:#bfd2c4;text-align:left;font-size:10px;cursor:pointer}.sidebar-tool>span{width:14px;text-align:center;font-size:13px}.sidebar-tool:hover,.sidebar-tool.active{background:#315a40;color:#fff}.sidebar-workspace-choices{display:grid;gap:2px;padding:0 5px 5px 24px}.sidebar-workspace-choices button{overflow:hidden;padding:6px 8px;border:0;border-radius:3px;background:#203f32;color:#d9e7dc;text-align:left;text-overflow:ellipsis;white-space:nowrap;font-size:9px;cursor:pointer}.sidebar-workspace-choices button:hover{background:#315a40;color:#fff}.sidebar-workspace-choices p{padding:5px 8px;color:#8da997;font-size:9px}
</style>
