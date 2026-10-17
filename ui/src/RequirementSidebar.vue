<script setup lang="ts">
defineProps<{requirements:any[];requirementId:string;featureId:string;view:string;projectId?:string}>();
const emit=defineEmits<{navigate:[path:string];createRequirement:[]}>();
const stages:Record<string,string>={GHERKIN:'需求確認',SD:'設計確認',TESTS:'BDD',IMPLEMENTATION:'開發',VERIFICATION:'驗證',VERIFIED:'已驗證'};
const href=(id:string,feature?:string)=>`/requirements/${encodeURIComponent(id)}${feature?'?featureId='+encodeURIComponent(feature):''}`;
</script>
<template>
 <aside class="sidebar requirement-sidebar" data-testid="requirement-sidebar" aria-label="需求工作台固定選單">
  <a class="brand" href="/requirements" @click.prevent="emit('navigate','/requirements')"><span class="brand-mark">b.</span><span><strong>需求工作台</strong><small>BDD WORKBENCH</small></span></a>
  <nav class="requirement-navigation" aria-label="需求導覽">
   <div class="sidebar-section"><a href="/requirements" @click.prevent="emit('navigate','/requirements')">需求</a><button aria-label="新增需求" title="新增需求" @click="emit('createRequirement')">＋</button></div>
   <div v-if="!requirements.length" class="sidebar-empty">尚無需求，按 ＋ 建立。</div>
   <details v-for="r in requirements" :key="r.id" open class="sidebar-requirement" :data-testid="'sidebar-requirement-'+r.id">
    <summary><a :href="href(r.id)" :aria-current="requirementId===r.id?'page':undefined" @click.stop.prevent="emit('navigate',href(r.id))">{{r.requirementKey}}</a><span>{{r.features.length}}</span></summary>
    <ul><li v-for="f in r.features" :key="f.id"><a :href="href(r.id,f.id)" :class="{active:requirementId===r.id&&featureId===f.id}" :aria-current="requirementId===r.id&&featureId===f.id?'page':undefined" @click.prevent="emit('navigate',href(r.id,f.id))"><span class="feature-name">{{f.featureKey}}</span><small>{{stages[f.stage]}}</small></a></li></ul>
   </details>
  </nav>
  <div class="sidebar-tools"><a class="nav-item" :class="{active:view==='terminal'}" :href="projectId?`/projects/${encodeURIComponent(projectId)}/terminal`:'/terminal'" data-testid="sidebar-terminal" @click.prevent="emit('navigate',projectId?`/projects/${encodeURIComponent(projectId)}/terminal`:'/terminal')"><span>⌘</span>Terminal</a></div>
  <div class="sidebar-settings"><a class="nav-item" :class="{active:view==='projects'||view==='overview'}" href="/projects" @click.prevent="emit('navigate','/projects')"><span>⚙</span>專案管理</a><p>綁定本機程式碼目錄</p></div>
 </aside>
</template>
<style scoped>
.requirement-sidebar{padding:24px 14px 16px;overflow:hidden}.brand{padding:4px 10px 28px}.requirement-navigation{min-height:0;overflow-y:auto;flex:1}.sidebar-section{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px}.sidebar-section>a{color:#d9ece0;text-decoration:none}.sidebar-section>button{color:inherit;background:transparent;border:1px solid #496856;border-radius:4px;width:28px;height:28px}.sidebar-empty{padding:16px 10px;font-size:12px;line-height:1.7}.sidebar-requirement{margin:4px 0}.sidebar-requirement>summary{display:list-item;padding:10px 6px 10px 10px;font-size:12px;color:#a9c2b2}.sidebar-requirement>summary>a{color:#e4f1e7;text-decoration:none;overflow-wrap:anywhere}.sidebar-requirement>summary>span{float:right;font-size:10px;margin-left:8px}.sidebar-requirement ul{list-style:none;margin:0 0 12px;padding:0 0 0 16px}.sidebar-requirement li>a{display:flex;align-items:center;gap:8px;padding:9px 8px;color:#bdd3c4;text-decoration:none;font-size:11px;border-radius:4px}.sidebar-requirement li>a:hover,.sidebar-requirement li>a.active{background:#315a40;color:#fff}.feature-name{flex:1;overflow-wrap:anywhere}.sidebar-requirement small{font-size:9px;white-space:nowrap;color:#9fbea9}.sidebar-tools{border-top:1px solid #345642;padding-top:10px}.sidebar-tools .nav-item{text-decoration:none;margin:0}.sidebar-tools .nav-item.active{background:#315a40;color:#fff}.sidebar-settings{border-top:1px solid #345642;padding-top:12px;margin-top:12px}.sidebar-settings .nav-item{text-decoration:none;margin:0}.sidebar-settings p{font-size:10px;margin:4px 12px;color:#94b39f}
</style>
