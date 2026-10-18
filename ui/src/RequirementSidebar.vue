<script setup lang="ts">
import {reactive,watch} from 'vue';
const props=defineProps<{requirements:any[];requirementId:string;featureId:string;view:string;projectId?:string;workflowStage:string}>();
const emit=defineEmits<{navigate:[path:string];createRequirement:[];createFeature:[requirementId:string]}>();
const workflowStages=[{key:'GHERKIN',label:'需求確認'},{key:'SD',label:'系統設計'},{key:'TESTS',label:'測試情境補齊'},{key:'IMPLEMENTATION',label:'程式開發'},{key:'VERIFICATION',label:'驗證報告'}];
const selectedFeatures=reactive<Record<string,string>>({});
const featureSelects=new Map<string,HTMLSelectElement>();
watch(()=>[props.requirementId,props.featureId] as const,([id,feature])=>{if(id&&feature)selectedFeatures[id]=feature;},{immediate:true});
const featureFor=(r:any)=>selectedFeatures[r.id]??(props.requirementId===r.id&&r.features.some((f:any)=>f.id===props.featureId)?props.featureId:r.features[0]?.id??'');
function bindFeatureSelect(id:string,element:Element|null){if(element instanceof HTMLSelectElement)featureSelects.set(id,element);else featureSelects.delete(id);}
function chooseFeature(r:any,event:Event){const feature=(event.target as HTMLSelectElement).value;selectedFeatures[r.id]=feature;emit('navigate',href(r.id,feature,r.id===props.requirementId?props.workflowStage:'GHERKIN'));}
function navigateStage(r:any,step:any){const feature=featureSelects.get(r.id)?.value||featureFor(r);emit('navigate',href(r.id,feature,step.key));}
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
     <nav class="sidebar-stage-list" :aria-label="r.requirementKey+' 流程階段'"><a v-for="(step,index) in workflowStages" :key="step.key" class="sidebar-stage" :href="href(r.id,featureFor(r),step.key)" :class="{active:requirementId===r.id&&workflowStage===step.key}" :aria-current="requirementId===r.id&&workflowStage===step.key?'page':undefined" @click.prevent="navigateStage(r,step)"><span class="stage-number">{{String(index+1).padStart(2,'0')}}</span><span>{{step.label}}</span></a><span v-if="!r.features.length" class="sidebar-stage-empty">先新增 Gherkin</span></nav>
    </div>
   </details>
  </nav>
  <div class="sidebar-tools"><a class="nav-item" :class="{active:view==='terminal'}" :href="projectId?`/projects/${encodeURIComponent(projectId)}/terminal`:'/terminal'" data-testid="sidebar-terminal" @click.prevent="emit('navigate',projectId?`/projects/${encodeURIComponent(projectId)}/terminal`:'/terminal')"><span>⌘</span>Terminal</a></div>
  <div class="sidebar-settings"><a class="nav-item" :class="{active:view==='projects'||view==='overview'}" href="/projects" @click.prevent="emit('navigate','/projects')"><span>⚙</span>專案管理</a></div>
 </aside>
</template>
<style scoped>
.requirement-sidebar{padding:24px 14px 16px;overflow:hidden}.brand{padding:4px 10px 28px}.requirement-navigation{min-height:0;overflow-y:auto;flex:1}.sidebar-section{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px}.sidebar-section>a{color:#d9ece0;text-decoration:none}.sidebar-section>button{color:inherit;background:transparent;border:1px solid #496856;border-radius:4px;width:28px;height:28px}.sidebar-empty{padding:16px 10px;font-size:12px;line-height:1.7}.sidebar-requirement{margin:4px 0}.sidebar-requirement>summary{display:list-item;padding:10px 6px 10px 10px;font-size:12px;color:#a9c2b2}.sidebar-requirement>summary>a{color:#e4f1e7;text-decoration:none;overflow-wrap:anywhere}.sidebar-requirement>summary>span{float:right;font-size:10px;margin-left:8px}.sidebar-workflow{padding:2px 0 8px 7px}.sidebar-feature-row{display:flex;gap:5px;padding:2px 5px 7px}.sidebar-feature-row select{padding:5px 7px;font-size:10px;color:#d9e7dc;background:#203f32;border-color:#345642}.sidebar-feature-row button{flex:0 0 28px;color:#d9e7dc;background:#203f32;border:1px solid #345642;border-radius:4px}.sidebar-stage-list{display:grid;gap:2px}.sidebar-stage{display:flex;align-items:center;gap:8px;padding:7px 9px;color:#bfd2c4;font-size:10px;text-decoration:none;border-radius:4px}.sidebar-stage:hover,.sidebar-stage.active{background:#315a40;color:#fff}.stage-number{font:9px Consolas,monospace;color:#9fbea9}.sidebar-stage-empty{padding:5px 9px;color:#8da997;font-size:9px}.sidebar-tools{border-top:1px solid #345642;padding-top:10px}.sidebar-tools .nav-item{text-decoration:none;margin:0}.sidebar-tools .nav-item.active{background:#315a40;color:#fff}.sidebar-settings{border-top:1px solid #345642;padding-top:12px;margin-top:12px}.sidebar-settings .nav-item{text-decoration:none;margin:0}.sidebar-settings p{font-size:10px;margin:4px 12px;color:#94b39f}
</style>
