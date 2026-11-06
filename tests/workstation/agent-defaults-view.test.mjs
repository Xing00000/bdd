import test from 'node:test';
import assert from 'node:assert/strict';
import {agentCatalogView} from '../../packages/workstation/public/agent-catalog.js';

// A small DOM adapter runs the actual view without requiring a browser binary.
// Browser layout and event integration remain covered by workstation-e2e.
class Element {
  constructor(tag,text){this.tagName=tag.toUpperCase();this.textContent=text??'';this.children=[];this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this._value='';}
  get options(){return this.children.filter(n=>n.tagName==='OPTION');}
  get value(){return this._value;}
  set value(value){this._value=String(value);}
  get isConnected(){return Boolean(this.connected||this.parentNode?.isConnected);}
  append(...nodes){for(const node of nodes){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);node.parentNode=this;this.children.push(node);if(this.tagName==='SELECT'&&!this.value&&node.tagName==='OPTION')this.value=node.value;}}
  replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];if(this.tagName==='SELECT')this.value='';this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  querySelectorAll(selector){return descendants(this).filter(n=>selector==='[data-skill]:checked'?n.dataset.skill==='1'&&n.checked:selector==='input:checked'&&n.tagName==='INPUT'&&n.checked);}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const purposes=['gherkin','design','testPlan','development'];
const titles={gherkin:'Gherkin',design:'系統設計',testPlan:'測試計劃',development:'實作'};
const deferred=()=>Promise.withResolvers();

async function harness(t) {
  const previousDocument=globalThis.document,previousOption=globalThis.Option;
  const root=new Element('section');root.connected=true;
  globalThis.document={querySelector:()=>root,createTextNode:text=>new Element('text',text)};
  globalThis.Option=class extends Element{constructor(text,value){super('option',text);this.value=value;}};
  t.after(()=>{globalThis.document=previousDocument;globalThis.Option=previousOption;});
  const template={runtime:'codex-sdk',model:'auto',maxAttempts:1,timeoutMs:1000};
  const catalog={purposes,agents:[{id:'alternate',name:'Alternate',revisions:[{id:'alternate-v1',version:1,settings:template}]}],prompts:[],skills:[],template,promptTemplates:{gherkin:'Seed prompt'}};
  const defaults=new Map(),writes=[],catalogWrites=[],messages=[],asks=[],dirtyEvents=[],reads=new Map();let saveGate,editorGate,dirty=false,discard=false;
  function seed(repositoryId){
    if(defaults.has(repositoryId))return;
    const agentRevisionId=repositoryId+'-agent-v1';
    catalog.agents.push({id:repositoryId+'-agent',name:repositoryId+' Agent',revisions:[{id:agentRevisionId,version:1}]});
    const entries=purposes.map(purpose=>{
      const promptRevisionId=`${repositoryId}-${purpose}-v1`;
      catalog.prompts.push({id:`${repositoryId}-${purpose}`,name:repositoryId+' '+purpose,revisions:[{id:promptRevisionId,version:1,purposes:[purpose]}]});
      return {purpose,agentRevisionId,promptRevisionId,skillRevisionIds:[]};
    });
    defaults.set(repositoryId,entries);
  }
  const api=async(route,method='GET',body)=>{
    if(route==='/agent-catalog')return structuredClone(catalog);
    const collection=route.match(/^\/agent-catalog\/(agents|prompts|skills)$/)?.[1];
    if(collection){
      assert.equal(method,'POST');catalogWrites.push({collection,...structuredClone(body)});
      const previous=catalog[collection].find(item=>item.id===body.id);
      if(body.id)assert.equal(body.expectedRevision,previous?.revisions[0].id,'stale editor revision');
      const id=body.id??collection+'-'+catalog[collection].length,version=(previous?.revisions[0].version??0)+1;
      const revision={id:id+'-v'+version,version,created_at:'2026-01-01',...(collection==='agents'?{settings:body.settings}:{content:body.content,purposes:body.purposes,resources:body.resources??[]})};
      const saved={id,name:body.name,description:body.description,archived:body.archived,revisions:[revision,...previous?.revisions??[]]};
      if(previous)catalog[collection][catalog[collection].indexOf(previous)]=saved;else catalog[collection].push(saved);
      const response=structuredClone(saved);
      if(editorGate){const gate=editorGate;editorGate=null;gate.held.resolve();await gate.release.promise;}
      return response;
    }
    const match=route.match(/^\/spec-repositories\/([^/]+)\/agent-defaults$/);assert.ok(match,route);const repositoryId=match[1];
    if(method==='GET'){
      const gate=reads.get(repositoryId);if(gate){reads.delete(repositoryId);gate.held.resolve();await gate.release.promise;}
      seed(repositoryId);return structuredClone(defaults.get(repositoryId));
    }
    assert.equal(method,'PUT');writes.push({repositoryId,...structuredClone(body)});
    Object.assign(defaults.get(repositoryId).find(d=>d.purpose===body.purpose),structuredClone(body));
    if(saveGate){const gate=saveGate;saveGate=null;gate.held.resolve();await gate.release.promise;}
    return structuredClone(body);
  };
  const el=(tag,text,cls)=>{const node=new Element(tag,text);if(cls)node.className=cls;return node;};
  const button=(text,action)=>{const node=el('button',text);node.onclick=action;return node;};
  const view=agentCatalogView({api,el,button,note:(message,error)=>messages.push({message,error}),ask:async(...args)=>{asks.push(args);return discard;},onDirty:()=>{dirtyEvents.push(true);dirty=true;},onSaved:()=>{dirtyEvents.push(false);dirty=false;}});
  await view.render([{id:'alpha',title:'Alpha'},{id:'beta',title:'Beta'}]);
  const find=(predicate,node=root)=>descendants(node).find(predicate);
  const repository=find(n=>n.attributes['aria-label']==='規格庫任務預設');
  const sections=()=>descendants(root).filter(n=>n.className==='catalog-default');
  const section=purpose=>sections().find(n=>n.children[0].textContent===titles[purpose]);
  const choice=purpose=>find(n=>n.attributes['aria-label']==='Agent',section(purpose));
  const changeAgent=(purpose,value)=>{const select=choice(purpose);select.value=value;for(let node=select;node;node=node.parentNode)node.onchange?.();};
  const save=purpose=>find(n=>n.tagName==='BUTTON'&&n.textContent==='儲存 '+titles[purpose]+' 預設',section(purpose)).onclick();
  const select=async repositoryId=>{repository.value=repositoryId;await repository.onchange();};
  const gate=()=>({held:deferred(),release:deferred()});
  const editor=find(n=>n.className==='panel catalog-editor');
  const editorField=label=>find(n=>n.attributes['aria-label']===label,editor);
  return {root,find,repository,sections,choice,changeAgent,save,select,writes,catalogWrites,catalog,editor,editorField,messages,asks,defaults,dirtyEvents,dirty:()=>dirty,
    openNew(label){return find(n=>n.tagName==='BUTTON'&&n.textContent==='新增 '+label).onclick();},
    fillEditor(label,value){editorField(label).value=value;editor.oninput();},
    submitEditor(){return find(n=>n.tagName==='FORM',editor).onsubmit({preventDefault(){}});},
    allowDiscard(){discard=true;},
    holdRead(repositoryId){const value=gate();reads.set(repositoryId,value);return value;},
    holdSave(){return saveGate=gate();},holdEditorSave(){return editorGate=gate();}};
}

test('the actual catalog view exposes lazy seed records immediately after loading defaults',async t=>{
  const h=await harness(t);assert.equal(h.find(n=>n.textContent==='編輯 alpha Agent'),undefined);
  await h.select('alpha');assert.equal(h.sections().length,4);
  assert.ok(h.find(n=>n.tagName==='BUTTON'&&n.textContent==='編輯 alpha Agent'));
  for(const purpose of purposes)assert.ok(h.find(n=>n.tagName==='BUTTON'&&n.textContent==='編輯 alpha '+purpose));
  assert.equal(h.dirty(),false);assert.deepEqual(h.messages,[]);
});

test('saving one task preserves other dirty selections and a cancelled repository switch',async t=>{
  const h=await harness(t);await h.select('alpha');h.changeAgent('gherkin','alternate-v1');h.changeAgent('design','alternate-v1');
  await h.save('gherkin');assert.equal(h.dirty(),true);
  await h.select('beta');assert.equal(h.asks.length,1);assert.equal(h.repository.value,'alpha');assert.equal(h.choice('design').value,'alternate-v1');
  assert.equal(h.defaults.get('alpha').find(d=>d.purpose==='design').agentRevisionId,'alpha-agent-v1');
  await h.save('design');assert.equal(h.dirty(),false);
  await h.select('beta');assert.equal(h.asks.length,1);assert.equal(h.choice('design').value,'beta-agent-v1');
  assert.deepEqual(h.writes.map(w=>[w.repositoryId,w.purpose]),[['alpha','gherkin'],['alpha','design']]);
});

test('changes during a pending save remain dirty before and after its response',async t=>{
  const h=await harness(t);await h.select('alpha');const gate=h.holdSave();h.changeAgent('gherkin','alternate-v1');
  const pending=h.save('gherkin');await gate.held.promise;h.changeAgent('gherkin','alpha-agent-v1');
  assert.equal(h.dirty(),true);gate.release.resolve();await pending;assert.equal(h.dirty(),true);
  assert.equal(h.defaults.get('alpha').find(d=>d.purpose==='gherkin').agentRevisionId,'alternate-v1');
  await h.select('beta');assert.equal(h.asks.length,1);assert.equal(h.choice('gherkin').value,'alpha-agent-v1');
});

test('late repository defaults do not mix controls or save to the previous repository',async t=>{
  const h=await harness(t),gate=h.holdRead('alpha');const alpha=h.select('alpha');await gate.held.promise;
  await h.select('beta');gate.release.resolve();await alpha;
  assert.equal(h.sections().length,4);for(const purpose of purposes)assert.equal(h.choice(purpose).value,'beta-agent-v1');
  h.changeAgent('gherkin','alternate-v1');await h.save('gherkin');
  assert.deepEqual(h.writes.map(w=>w.repositoryId),['beta']);assert.equal(h.defaults.get('alpha').find(d=>d.purpose==='gherkin').agentRevisionId,'alpha-agent-v1');
});

for(const [label,collection,bodyLabel] of [['Agent','agents','說明'],['Prompt','prompts','Prompt 內容'],['Skill','skills','Skill 內容']]){
  test(`${label} editor preserves newer input during creation and continues the same version history`,async t=>{
    const h=await harness(t);await h.openNew(label);h.fillEditor('名稱','Submitted name');h.fillEditor(bodyLabel,'Submitted body');
    if(label==='Agent'){
      assert.ok(h.find(n=>n.textContent==='執行引擎：Codex SDK · 模型 API：Copilot ACP'));
      for(const field of ['執行方式','CLI 執行檔','CLI 參數（每行一個）'])assert.equal(h.editorField(field),undefined);
      h.fillEditor('模型（auto 沿用對話設定）','selected-model');
    }
    const gate=h.holdEditorSave(),pending=h.submitEditor();await gate.held.promise;
    h.fillEditor('名稱','Unsaved newer name');h.fillEditor(bodyLabel,'Unsaved newer body');gate.release.resolve();await pending;await new Promise(setImmediate);
    assert.equal(h.editorField('名稱').value,'Unsaved newer name');assert.equal(h.editorField(bodyLabel).value,'Unsaved newer body');assert.equal(h.dirty(),true);
    const saved=h.catalog[collection].find(item=>item.name==='Submitted name');assert.ok(saved);assert.equal(saved.revisions.length,1);
    if(label==='Agent')assert.deepEqual(saved.revisions[0].settings,{runtime:'codex-sdk',model:'selected-model',maxAttempts:1,timeoutMs:1000});
    await h.submitEditor();await new Promise(setImmediate);
    assert.equal(h.catalogWrites[1].id,saved.id);assert.equal(h.catalogWrites[1].expectedRevision,saved.revisions[0].id);
    const latest=h.catalog[collection].find(item=>item.id===saved.id);assert.equal(latest.name,'Unsaved newer name');assert.equal(latest.revisions.length,2);assert.equal(h.dirty(),false);
    assert.equal(h.catalog[collection].filter(item=>item.id===saved.id).length,1);
  });
}

test('a completed catalog save cannot replace a different editor opened while it was pending',async t=>{
  const h=await harness(t);await h.openNew('Agent');h.fillEditor('名稱','Submitted agent');
  const gate=h.holdEditorSave(),pending=h.submitEditor();await gate.held.promise;
  h.allowDiscard();await h.openNew('Prompt');h.fillEditor('名稱','New prompt draft');h.fillEditor('Prompt 內容','Keep this newer draft');
  gate.release.resolve();await pending;await new Promise(setImmediate);
  assert.equal(h.editorField('名稱').value,'New prompt draft');assert.equal(h.editorField('Prompt 內容').value,'Keep this newer draft');assert.equal(h.dirty(),true);
  await h.submitEditor();await new Promise(setImmediate);
  assert.equal(h.catalogWrites[1].collection,'prompts');assert.equal(h.catalogWrites[1].id,undefined);assert.equal(h.catalog.prompts.length,1);
});

test('a save response after leaving catalog cannot invoke another page\'s dirty callbacks',async t=>{
  const h=await harness(t);await h.openNew('Agent');h.fillEditor('名稱','Submitted agent');
  const gate=h.holdEditorSave(),pending=h.submitEditor();await gate.held.promise;
  h.root.hidden=true;const callbackCount=h.dirtyEvents.length;
  gate.release.resolve();await pending;await new Promise(setImmediate);
  assert.equal(h.dirtyEvents.length,callbackCount);assert.equal(h.dirty(),true);assert.deepEqual(h.messages,[]);
  assert.ok(h.catalog.agents.some(item=>item.name==='Submitted agent'));
});
