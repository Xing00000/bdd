import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdirSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionError,requireThat as ok,text,identifier as id,integer,object,fields,canonical,digest,checkSchema,validateOutput,cliPolicy} from './contracts.mjs';

const uid=prefix=>`${prefix}-${randomUUID()}`;
const now=()=>new Date().toISOString();
const parse=value=>value==null?null:JSON.parse(value);
const busy="('RESERVED','RUNNING','UNKNOWN')";
const terminalNodes=['SUCCEEDED','FAILED','CANCELLED'];
const catalogKinds=['skill','soul','bot','workflow','contract','profile'];
const human={kind:'human',id:'local'};

/** Additive, scoped state core. No child processes, Git, model calls or network inside transactions. */
export class SessionManager {
  constructor(file,{workstationId='local',worktreeRoot,maxWorkers=8}={}) {
    this.workstationId=id(workstationId);this.worktreeRoot=path.resolve(worktreeRoot??path.join(path.dirname(file),'task-worktrees'));
    if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.transaction(()=>{
        if(!this.one("SELECT name FROM sqlite_master WHERE type='table' AND name='sm_migrations'")) {
          this.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
          this.exec('INSERT INTO sm_migrations VALUES(1,?)',now());
        }
        ok(this.one('SELECT MAX(version) version FROM sm_migrations').version===1,'MIGRATION_REQUIRED','Unsupported session schema version');
        integer(maxWorkers,'maxWorkers',1,64);
        this.exec('INSERT OR IGNORE INTO sm_workstations VALUES(?,?)',this.workstationId,maxWorkers);
      });
    }catch(error){this.db.close();throw error;}
  }
  close(){this.db.close();}
  one(sql,...args){return this.db.prepare(sql).get(...args);}
  all(sql,...args){return this.db.prepare(sql).all(...args);}
  exec(sql,...args){return this.db.prepare(sql).run(...args);}
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try{const value=action();ok(!value?.then,'ASYNC_TRANSACTION','Transactions must be synchronous');this.db.exec('COMMIT');return value;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  catalog(kind,ref) {
    ok(catalogKinds.includes(kind),'INVALID_KIND','Unknown catalog kind',400);
    id(ref.id);integer(ref.revision,'revision',1);
    const row=this.one('SELECT * FROM sm_catalog WHERE workstation_id=? AND kind=? AND id=? AND revision=?',this.workstationId,kind,ref.id,ref.revision);
    ok(row,'CATALOG_NOT_FOUND',`${kind} revision not found`,404);
    return {id:row.id,revision:row.revision,digest:row.digest,body:parse(row.body)};
  }
  task(taskId) {
    const row=this.one('SELECT * FROM sm_tasks WHERE workstation_id=? AND id=?',this.workstationId,id(taskId));
    ok(row,'TASK_NOT_FOUND','Task not found',404);return row;
  }
  node(nodeId) {
    const row=this.one('SELECT n.* FROM sm_nodes n JOIN sm_tasks t ON t.id=n.task_id WHERE t.workstation_id=? AND n.id=?',this.workstationId,id(nodeId));
    ok(row,'NODE_NOT_FOUND','Node not found',404);return {...row,config:parse(row.config)};
  }
  session(sessionId) {
    const row=this.one('SELECT * FROM sm_bot_task_sessions WHERE workstation_id=? AND id=?',this.workstationId,id(sessionId));
    ok(row,'SESSION_NOT_FOUND','Session not found',404);return row;
  }
  room(taskId){this.task(taskId);return this.one('SELECT * FROM sm_rooms WHERE task_id=?',taskId);}
  activeTask(taskId){const row=this.task(taskId);ok(row.state==='ACTIVE','TASK_NOT_ACTIVE','Task is not active');return row;}
  human(actor){ok(actor.kind==='human','HUMAN_REQUIRED','An authenticated human is required',403);}
  system(actor){ok(actor.kind==='system','CONTROLLER_REQUIRED','Only the trusted controller may record execution receipts',403);}
  nodeActor(node,actor) {
    ok(actor.kind==='system'||(actor.kind==='bot'&&actor.id===node.bot_id&&actor.taskId===node.task_id&&actor.nodeId===node.id),'NODE_FORBIDDEN','Actor is not bound to this node',403);
    if(actor.kind==='bot'){const session=this.one('SELECT * FROM sm_bot_task_sessions WHERE task_id=? AND bot_id=?',node.task_id,node.bot_id);ok(session&&session.active_node_id===node.id&&session.generation===actor.generation,'STALE_GENERATION','Bot capability is not the current runtime generation');}
  }
  event(taskId,type,payload,actor,target=null) {
    const room=this.room(taskId),seq=room.next_seq;
    this.exec('UPDATE sm_rooms SET next_seq=next_seq+1 WHERE id=?',room.id);
    const event={id:uid('event'),roomId:room.id,seq,type,actorKind:actor.kind,actorId:actor.id,target,payload,createdAt:now()};
    this.exec('INSERT INTO sm_events VALUES(?,?,?,?,?,?,?,?,?)',event.id,room.id,seq,actor.kind,actor.id,type,target,canonical(payload),event.createdAt);
    return event;
  }
  /** actor comes from a trusted boundary, NEVER from a user message or model output. */
  command(command,input,{actor=human,requestId=uid('request')}={}) {
    text(command,'command',80);id(requestId);id(actor.id);ok(['human','bot','system'].includes(actor.kind),'INVALID_ACTOR','Invalid actor',403);
    ok(Buffer.byteLength(canonical(input))<=262144,'INPUT_TOO_LARGE','Input exceeds 256 KiB',413);
    const actorKey=canonical({kind:actor.kind,id:actor.id,taskId:actor.taskId??null,nodeId:actor.nodeId??null,generation:actor.generation??null});
    const inputHash=digest({command,input});
    return this.transaction(()=>{
      const previous=this.one('SELECT * FROM sm_commands WHERE workstation_id=? AND actor=? AND request_id=?',this.workstationId,actorKey,requestId);
      if(previous){ok(previous.digest===inputHash,'IDEMPOTENCY_CONFLICT','Request ID reused with different content');return parse(previous.response);}
      const response=this.apply(command,input,actor);
      this.exec('INSERT INTO sm_commands VALUES(?,?,?,?,?)',this.workstationId,actorKey,requestId,inputHash,canonical(response));
      return response;
    });
  }
  apply(command,input,actor) {
    switch(command) {
      case 'project.create': {
        this.human(actor);fields(input,['id','name'],['name']);const projectId=input.id?id(input.id):uid('project');
        this.exec('INSERT INTO sm_projects VALUES(?,?,?)',this.workstationId,projectId,text(input.name,'name',200));return {id:projectId};
      }
      case 'repository.register': {
        this.human(actor);fields(input,['id','projectId','name','rootPath','remoteUrl'],['projectId','name','rootPath']);
        ok(this.one('SELECT id FROM sm_projects WHERE workstation_id=? AND id=?',this.workstationId,id(input.projectId)),'PROJECT_NOT_FOUND','Project not found',404);
        text(input.rootPath,'rootPath',4096);ok(path.isAbsolute(input.rootPath),'INVALID_PATH','Repository path must be absolute',400);
        const root=realpathSync(input.rootPath),repositoryId=input.id?id(input.id):uid('repo');
        this.exec('INSERT INTO sm_repositories VALUES(?,?,?,?,?)',this.workstationId,repositoryId,text(input.name,'name',200),root,input.remoteUrl??'');
        this.exec('INSERT INTO sm_project_repositories VALUES(?,?,?)',this.workstationId,input.projectId,repositoryId);return {id:repositoryId,rootPath:root};
      }
      case 'repository.link': {
        this.human(actor);fields(input,['projectId','repositoryId'],['projectId','repositoryId']);
        this.exec('INSERT INTO sm_project_repositories VALUES(?,?,?)',this.workstationId,id(input.projectId),id(input.repositoryId));return {linked:true};
      }
      case 'catalog.save': return this.saveCatalog(input,actor);
      case 'task.create': return this.createTask(input,actor);
      case 'worktree.ready': {
        this.system(actor);fields(input,['taskId','baseSha','path','branch'],['taskId','baseSha','path','branch']);const task=this.task(input.taskId);
        ok(task.state==='PROVISIONING','TASK_STATE_CONFLICT','Task is no longer provisioning');
        const wt=this.one('SELECT * FROM sm_worktrees WHERE task_id=?',task.id);
        ok(input.path===wt.path&&input.branch===wt.branch&&/^[a-f0-9]{40}$/.test(input.baseSha),'WORKTREE_RECEIPT_INVALID','Worktree receipt does not match');
        this.exec("UPDATE sm_worktrees SET state='READY',base_sha=?,receipt=?,error=NULL WHERE task_id=?",input.baseSha,canonical(input),task.id);
        this.exec("UPDATE sm_tasks SET state='ACTIVE',version=version+1 WHERE id=?",task.id);this.refreshReady(task.id);
        this.event(task.id,'worktree.ready',{baseSha:input.baseSha},actor);return this.detail(task.id);
      }
      case 'worktree.failed': {
        this.system(actor);const task=this.task(input.taskId);ok(task.state==='PROVISIONING','TASK_STATE_CONFLICT','Not provisioning');
        this.exec("UPDATE sm_worktrees SET state='ERROR',error=? WHERE task_id=?",text(input.message,'message'),task.id);
        return {taskId:task.id,state:'PROVISIONING',error:input.message};
      }
      case 'node.start': {
        this.system(actor);fields(input,['nodeId','expectedVersion'],['nodeId','expectedVersion']);const node=this.node(input.nodeId);this.activeTask(node.task_id);
        ok(node.state==='READY'&&node.version===input.expectedVersion,'NODE_STATE_CONFLICT','Node is not ready or has changed');
        const session=this.ensureSession(node);
        ok(session.active_node_id===null||session.active_node_id===node.id,'BOT_SESSION_BUSY','The Bot already has another active node in this task');
        this.exec("UPDATE sm_nodes SET state='RUNNING',version=version+1 WHERE id=?",node.id);
        this.exec('UPDATE sm_bot_task_sessions SET active_node_id=? WHERE id=?',node.id,session.id);
        this.event(node.task_id,'node.started',{nodeId:node.id,botId:node.bot_id},actor);return this.context(node.id);
      }
      case 'runtime.attach': {
        this.system(actor);fields(input,['sessionId','expectedGeneration','adapter','nativeId'],['sessionId','expectedGeneration','adapter','nativeId']);
        const session=this.session(input.sessionId);this.activeTask(session.task_id);
        ok(session.generation===input.expectedGeneration,'STALE_GENERATION','Runtime generation changed');
        const node=this.node(session.active_node_id);ok(node.state==='RUNNING','NODE_STATE_CONFLICT','No running node');
        ok(input.adapter===node.config.bot.body.runtime,'RUNTIME_MISMATCH','Runtime differs from frozen Bot');text(input.nativeId,'nativeId',256);
        const native=uid('native'),generation=session.generation+1;
        this.exec('INSERT INTO sm_native_sessions VALUES(?,?,?,?,?,?,?)',native,this.workstationId,session.id,generation,input.adapter,input.nativeId,now());
        this.exec('UPDATE sm_bot_task_sessions SET native_session_id=?,generation=? WHERE id=?',native,generation,session.id);
        this.event(session.task_id,'runtime.attached',{sessionId:session.id,generation,adapter:input.adapter},actor);return this.session(session.id);
      }
      case 'session.cursor': return this.advanceCursor(input,actor);
      case 'room.message': return this.message(input,actor);
      case 'memory.summarize': return this.summarize(input,actor);
      case 'node.submit': return this.submit(input,actor);
      case 'node.approve': {
        this.human(actor);fields(input,['nodeId','candidateDigest','expectedVersion'],['nodeId','candidateDigest','expectedVersion']);const node=this.node(input.nodeId);this.activeTask(node.task_id);
        ok(node.state==='WAITING_HUMAN'&&node.version===input.expectedVersion,'NODE_STATE_CONFLICT','Node is not waiting for this approval');
        const candidate=this.one('SELECT * FROM sm_candidates WHERE node_id=?',node.id);
        ok(candidate&&candidate.digest===input.candidateDigest,'STALE_APPROVAL','Candidate changed');
        return this.publish(node,candidate,actor);
      }
      case 'worker.reserve': return this.reserveWorker(input,actor);
      case 'worker.receipt': return this.workerReceipt(input,actor);
      case 'worker.event': {
        this.system(actor);const worker=this.worker(input.workerId);integer(input.seq,'seq',1);ok(object(input.payload),'INVALID_INPUT','Event payload required',400);
        const prev=this.one('SELECT payload FROM sm_worker_events WHERE worker_id=? AND seq=?',worker.id,input.seq);
        if(prev){ok(prev.payload===canonical(input.payload),'EVENT_CONFLICT','Worker event changed');return {seq:input.seq};}
        const last=this.one('SELECT COALESCE(MAX(seq),0) seq FROM sm_worker_events WHERE worker_id=?',worker.id).seq;
        ok(input.seq===last+1,'EVENT_GAP','Worker event sequence must be contiguous');
        this.exec('INSERT INTO sm_worker_events VALUES(?,?,?)',worker.id,input.seq,canonical(input.payload));return {seq:input.seq};
      }
      case 'worker.turn': {
        this.system(actor);const worker=this.worker(input.workerId),node=this.node(worker.node_id);this.activeTask(node.task_id);
        ok(worker.state==='RUNNING','WORKER_NOT_RUNNING','Worker is not running');
        ok(worker.turns<node.config.cliPolicy.maxTurns,'CLI_TURN_LIMIT','Worker turn budget exhausted');
        this.exec('UPDATE sm_workers SET turns=turns+1 WHERE id=?',worker.id);return {turn:worker.turns+1};
      }
      case 'task.cancel': {
        this.human(actor);fields(input,['taskId','expectedVersion'],['taskId','expectedVersion']);const task=this.task(input.taskId);
        ok(task.version===input.expectedVersion,'TASK_STATE_CONFLICT','Task changed');ok(!['COMPLETED','CANCELLED'].includes(task.state),'TASK_FINISHED','Task already finished');
        this.exec("UPDATE sm_tasks SET state='CANCELLED',version=version+1 WHERE id=?",task.id);
        this.exec("UPDATE sm_nodes SET state='CANCELLED',version=version+1 WHERE task_id=? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED')",task.id);
        this.exec("UPDATE sm_worktrees SET state='CLEANUP_PENDING' WHERE task_id=?",task.id);
        this.event(task.id,'task.cancelled',{workerCleanup:'pending-confirmation'},actor);return this.detail(task.id);
      }
      default: throw new SessionError('UNKNOWN_COMMAND',`Unknown session command: ${command}`,404);
    }
  }
  saveCatalog(input,actor) {
    this.human(actor);fields(input,['kind','id','expectedRevision','body'],['kind','id','expectedRevision','body']);
    const kind=input.kind,catalogId=id(input.id);integer(input.expectedRevision,'expectedRevision');ok(catalogKinds.includes(kind),'INVALID_KIND','Unknown catalog kind',400);
    const last=this.one('SELECT COALESCE(MAX(revision),0) revision FROM sm_catalog WHERE workstation_id=? AND kind=? AND id=?',this.workstationId,kind,catalogId).revision;
    ok(last===input.expectedRevision,'REVISION_CONFLICT','Catalog changed');this.validateCatalog(kind,input.body);
    const revision=last+1;
    this.exec('INSERT INTO sm_catalog VALUES(?,?,?,?,?,?,?)',this.workstationId,kind,catalogId,revision,canonical(input.body),digest(input.body),now());
    if(kind==='soul') this.exec('INSERT OR IGNORE INTO sm_soul_memory VALUES(?,?,?)',this.workstationId,catalogId,uid('memory'));
    return this.catalog(kind,{id:catalogId,revision});
  }
  validateCatalog(kind,body) {
    ok(object(body),'INVALID_INPUT','Catalog body must be an object',400);text(body.name,'name',200);
    if(kind==='skill'){fields(body,['name','instructions'],['name','instructions']);text(body.instructions,'instructions',32768);}
    if(kind==='profile') {
      fields(body,['name','transport','connectionRef'],['name','transport','connectionRef']);
      ok(body.transport==='acp','INVALID_PROFILE','Only an ACP profile reference is accepted',400);id(body.connectionRef);
    }
    if(kind==='soul') {
      fields(body,['name','roleTags','thinkingStyle','avatarAssetId','skills'],['name','roleTags','thinkingStyle','avatarAssetId','skills']);
      ok(Array.isArray(body.roleTags)&&body.roleTags.length>0&&body.roleTags.length<=32&&new Set(body.roleTags).size===body.roleTags.length,'INVALID_SOUL','Role tags must be unique',400);body.roleTags.forEach(id);
      text(body.thinkingStyle,'thinkingStyle',8192);id(body.avatarAssetId);
      ok(Array.isArray(body.skills)&&body.skills.length<=32,'INVALID_SOUL','Invalid skills',400);
      for(const ref of body.skills){fields(ref,['id','revision','config'],['id','revision','config']);this.catalog('skill',ref);ok(object(ref.config),'INVALID_SKILL_CONFIG','Expected skill config object',400);}
      ok(new Set(body.skills.map(s=>s.id)).size===body.skills.length,'INVALID_SOUL','Duplicate skill',400);
    }
    if(kind==='bot') {
      fields(body,['name','soul','runtime','acpProfile','model'],['name','soul','runtime','acpProfile','model']);
      this.catalog('soul',body.soul);this.catalog('profile',body.acpProfile);text(body.model,'model',200);
      ok(['codex-sdk','claude-agent-sdk'].includes(body.runtime),'INVALID_RUNTIME','Unsupported runtime identifier',400);
    }
    if(kind==='contract'){fields(body,['name','schema'],['name','schema']);checkSchema(body.schema);}
    if(kind==='workflow') {
      fields(body,['name','nodes'],['name','nodes']);ok(Array.isArray(body.nodes)&&body.nodes.length>0&&body.nodes.length<=64,'INVALID_WORKFLOW','Expected 1-64 nodes',400);
      const keys=new Set();
      for(const node of body.nodes) {
        fields(node,['key','bot','goal','dependsOn','output','cliPolicy','requiresHumanApproval'],['key','bot','goal','dependsOn','output','cliPolicy','requiresHumanApproval']);
        id(node.key);ok(!keys.has(node.key),'INVALID_WORKFLOW','Duplicate node key',400);keys.add(node.key);text(node.goal,'goal',8192);
        this.catalog('bot',node.bot);this.catalog('contract',node.output);cliPolicy(node.cliPolicy);
        ok(typeof node.requiresHumanApproval==='boolean'&&Array.isArray(node.dependsOn)&&new Set(node.dependsOn).size===node.dependsOn.length,'INVALID_WORKFLOW','Invalid node dependencies or approval',400);
      }
      const botVersions=new Map();
      for(const node of body.nodes){ok(!botVersions.has(node.bot.id)||botVersions.get(node.bot.id)===node.bot.revision,'BOT_REVISION_CONFLICT','A task cannot mix revisions of the same Bot',400);botVersions.set(node.bot.id,node.bot.revision);}
      const done=new Set(),pending=new Map(body.nodes.map(n=>[n.key,n]));
      while(pending.size){const ready=[...pending.values()].filter(n=>n.dependsOn.every(k=>done.has(k)));ok(ready.length,'WORKFLOW_CYCLE','Unknown dependency or dependency cycle',400);for(const node of ready){done.add(node.key);pending.delete(node.key);}}
    }
  }
  freezeNode(node) {
    const bot=this.catalog('bot',node.bot),soul=this.catalog('soul',bot.body.soul);
    return {...node,bot,soul,skills:soul.body.skills.map(ref=>({...this.catalog('skill',ref),config:ref.config})),profile:this.catalog('profile',bot.body.acpProfile),output:this.catalog('contract',node.output)};
  }
  createTask(input,actor) {
    this.human(actor);fields(input,['id','projectId','repositoryId','title','workflow'],['projectId','repositoryId','title','workflow']);
    const taskId=input.id?id(input.id):uid('task');
    ok(this.one('SELECT 1 FROM sm_project_repositories WHERE workstation_id=? AND project_id=? AND repository_id=?',this.workstationId,id(input.projectId),id(input.repositoryId)),'REPOSITORY_SCOPE','Repository does not belong to this project',403);
    const workflow=this.catalog('workflow',input.workflow),nodes=workflow.body.nodes.map(node=>this.freezeNode(node));
    this.exec('INSERT INTO sm_tasks(workstation_id,id,project_id,repository_id,title,state,created_at) VALUES(?,?,?,?,?,?,?)',this.workstationId,taskId,input.projectId,input.repositoryId,text(input.title,'title',500),'PROVISIONING',now());
    const snapshot={name:workflow.body.name,nodes};
    this.exec('INSERT INTO sm_workflows VALUES(?,?,?,?,?)',taskId,workflow.id,workflow.revision,canonical(snapshot),digest(snapshot));
    // The path is generated, never supplied by a model. Merely reserving it is not a Git receipt.
    const suffix=digest({workstationId:this.workstationId,taskId}).slice(0,32);
    this.exec('INSERT INTO sm_worktrees(task_id,path,branch,state) VALUES(?,?,?,?)',taskId,path.join(this.worktreeRoot,suffix),`wb/task-${suffix}`,'PENDING');
    this.exec('INSERT INTO sm_rooms(id,task_id) VALUES(?,?)',uid('room'),taskId);
    for(const config of nodes){const nodeId=uid('node');this.exec('INSERT INTO sm_nodes(id,task_id,node_key,bot_id,config,state) VALUES(?,?,?,?,?,?)',nodeId,taskId,config.key,config.bot.id,canonical(config),'BLOCKED');this.ensureSession(this.node(nodeId));}
    this.event(taskId,'task.created',{workflow:{id:workflow.id,revision:workflow.revision},projectId:input.projectId},actor);
    return this.detail(taskId);
  }
  ensureSession(node) {
    const old=this.one('SELECT * FROM sm_bot_task_sessions WHERE workstation_id=? AND bot_id=? AND task_id=?',this.workstationId,node.bot_id,node.task_id);
    if(old)return old;
    const sessionId=uid('bot-task');this.exec('INSERT INTO sm_bot_task_sessions(id,workstation_id,bot_id,task_id) VALUES(?,?,?,?)',sessionId,this.workstationId,node.bot_id,node.task_id);return this.session(sessionId);
  }
  refreshReady(taskId) {
    const nodes=this.all('SELECT * FROM sm_nodes WHERE task_id=?',taskId),completed=new Set(nodes.filter(n=>n.state==='SUCCEEDED').map(n=>n.node_key));
    for(const node of nodes)if(node.state==='BLOCKED'&&parse(node.config).dependsOn.every(key=>completed.has(key)))this.exec("UPDATE sm_nodes SET state='READY',version=version+1 WHERE id=?",node.id);
    if(nodes.length&&nodes.every(n=>n.state==='SUCCEEDED'))this.exec("UPDATE sm_tasks SET state='WAITING_ACCEPTANCE',version=version+1 WHERE id=? AND state='ACTIVE'",taskId);
  }
  message(input,actor) {
    fields(input,['taskId','target','text'],['taskId','target','text']);const task=this.activeTask(input.taskId);text(input.text,'text',32768);
    ok(actor.kind==='human'||(actor.kind==='bot'&&actor.taskId===task.id),'MESSAGE_FORBIDDEN','Actor cannot access this conversation',403);
    if(actor.kind==='bot')this.nodeActor(this.node(actor.nodeId),actor);
    const active=this.all("SELECT * FROM sm_nodes WHERE task_id=? AND state IN ('READY','RUNNING','WAITING_HUMAN')",task.id);
    const targets=['room',...active.map(n=>'bot:'+n.bot_id)];
    ok(targets.includes(input.target),'BOT_NOT_PARTICIPATING','Target is not in the current workflow stage',409);
    const event=this.event(task.id,'message.queued',{text:input.text,delivery:'QUEUED'},actor,input.target);
    return {messageId:event.id,roomId:event.roomId,seq:event.seq,delivery:'QUEUED'};
  }
  advanceCursor(input,actor) {
    fields(input,['sessionId','generation','source','seq'],['sessionId','generation','source','seq']);const session=this.session(input.sessionId);
    ok(actor.kind==='system'||(actor.kind==='bot'&&actor.id===session.bot_id&&actor.taskId===session.task_id),'SESSION_FORBIDDEN','Actor cannot update this session',403);
    this.activeTask(session.task_id);if(actor.kind==='bot')ok(actor.generation===session.generation,'STALE_GENERATION','Bot capability expired');ok(input.generation===session.generation,'STALE_GENERATION','Runtime generation changed');integer(input.seq,'seq');
    let upper;
    if(input.source==='room') upper=this.room(session.task_id).next_seq-1;
    else {
      ok(typeof input.source==='string'&&input.source.startsWith('worker:'),'INVALID_SOURCE','Unknown cursor source',400);
      const worker=this.worker(input.source.slice(7)),node=this.node(worker.node_id);ok(node.task_id===session.task_id&&node.bot_id===session.bot_id,'CURSOR_SCOPE','Worker does not belong to this BotTask',403);
      upper=this.one('SELECT COALESCE(MAX(seq),0) seq FROM sm_worker_events WHERE worker_id=?',worker.id).seq;
    }
    const previous=this.one('SELECT seq FROM sm_cursors WHERE logical_session_id=? AND source=?',session.id,input.source)?.seq??0;
    ok(input.seq>=previous&&input.seq<=upper,'CURSOR_OUT_OF_RANGE','Cursor cannot move backwards or beyond observed events');
    this.exec('INSERT INTO sm_cursors VALUES(?,?,?) ON CONFLICT(logical_session_id,source) DO UPDATE SET seq=excluded.seq',session.id,input.source,input.seq);return {seq:input.seq};
  }
  summarize(input,actor) {
    this.human(actor);fields(input,['soulId','projectId','category','summary','sourceEventIds','shareAcrossProjects'],['soulId','projectId','category','summary','sourceEventIds']);
    const memory=this.one('SELECT * FROM sm_soul_memory WHERE workstation_id=? AND soul_id=?',this.workstationId,id(input.soulId));ok(memory,'SOUL_NOT_FOUND','Soul not found',404);
    text(input.summary,'summary',2000);ok(['PREFERENCE','DECISION','LEARNED_RULE','OPEN_ISSUE'].includes(input.category),'INVALID_CATEGORY','Unknown memory category',400);
    ok(Array.isArray(input.sourceEventIds)&&input.sourceEventIds.length>0&&input.sourceEventIds.length<=32,'MEMORY_SOURCE_REQUIRED','Memory must have 1-32 source events',400);
    for(const eventId of input.sourceEventIds) {
      const source=this.one('SELECT e.*,r.task_id,t.project_id FROM sm_events e JOIN sm_rooms r ON r.id=e.room_id JOIN sm_tasks t ON t.id=r.task_id WHERE t.workstation_id=? AND e.id=?',this.workstationId,id(eventId));
      ok(source&&source.project_id===input.projectId,'MEMORY_SCOPE','Source is outside the project',403);
      const participated=this.all('SELECT config FROM sm_nodes WHERE task_id=?',source.task_id).some(n=>parse(n.config).soul.id===input.soulId);
      ok(participated,'MEMORY_SCOPE','Soul did not participate in the source task',403);
    }
    ok(input.shareAcrossProjects===undefined||typeof input.shareAcrossProjects==='boolean','INVALID_INPUT','shareAcrossProjects must be boolean',400);
    const scope=input.shareAcrossProjects===true?null:id(input.projectId);
    const previous=this.one('SELECT id FROM sm_summaries WHERE workstation_id=? AND memory_session_id=? AND project_id IS ? AND category=? AND summary=?',this.workstationId,memory.id,scope,input.category,input.summary);
    if(previous)return {id:previous.id,memorySessionId:memory.id,scope:scope===null?'WORKSTATION':'PROJECT'};
    ok(this.one('SELECT COUNT(*) n FROM sm_summaries WHERE workstation_id=? AND memory_session_id=? AND project_id IS ?',this.workstationId,memory.id,scope).n<200,'MEMORY_LIMIT','Memory scope needs explicit compaction before adding more summaries');
    const summaryId=uid('summary');
    this.exec('INSERT INTO sm_summaries VALUES(?,?,?,?,?,?,?,?)',summaryId,this.workstationId,memory.id,input.shareAcrossProjects===true?null:id(input.projectId),input.category,input.summary,canonical(input.sourceEventIds),now());
    return {id:summaryId,memorySessionId:memory.id,scope:input.shareAcrossProjects===true?'WORKSTATION':'PROJECT'};
  }
  memory(soulId,projectId) {
    ok(this.one('SELECT 1 FROM sm_projects WHERE workstation_id=? AND id=?',this.workstationId,id(projectId)),'PROJECT_NOT_FOUND','Project not found',404);
    const memory=this.one('SELECT * FROM sm_soul_memory WHERE workstation_id=? AND soul_id=?',this.workstationId,id(soulId));ok(memory,'SOUL_NOT_FOUND','Soul not found',404);
    return {id:memory.id,entries:this.all('SELECT id,category,summary,project_id,source_events,created_at FROM sm_summaries WHERE workstation_id=? AND memory_session_id=? AND (project_id=? OR project_id IS NULL) ORDER BY created_at,id',this.workstationId,memory.id,projectId).map(row=>({...row,source_events:parse(row.source_events)}))};
  }
  submit(input,actor) {
    fields(input,['nodeId','expectedVersion','inputRevision','generation','data'],['nodeId','expectedVersion','inputRevision','generation','data']);
    const node=this.node(input.nodeId),task=this.activeTask(node.task_id);this.nodeActor(node,actor);
    ok(node.state==='RUNNING'&&node.version===input.expectedVersion,'NODE_STATE_CONFLICT','Node is not running or changed');
    const session=this.ensureSession(node);
    ok(session.native_session_id&&session.generation===input.generation,'STALE_GENERATION','A current native Session is required');
    ok(task.input_revision===input.inputRevision,'STALE_INPUT','Task input changed');
    ok(!this.one(`SELECT 1 FROM sm_workers WHERE node_id=? AND state IN ${busy}`,node.id),'WORKER_STILL_ACTIVE','Confirm all workers stopped before final output');
    validateOutput(node.config.output.body.schema,input.data);
    const candidate={id:uid('candidate'),node_id:node.id,task_revision:task.input_revision,generation:session.generation,digest:digest(input.data),data:canonical(input.data),producer:canonical({kind:actor.kind,id:actor.id,logicalSessionId:session.id,nativeSessionId:session.native_session_id})};
    this.exec('INSERT INTO sm_candidates VALUES(?,?,?,?,?,?,?)',...Object.values(candidate));
    if(node.config.requiresHumanApproval){this.exec("UPDATE sm_nodes SET state='WAITING_HUMAN',version=version+1 WHERE id=?",node.id);this.event(task.id,'node.awaiting_approval',{nodeId:node.id,candidateDigest:candidate.digest},actor);return {state:'WAITING_HUMAN',candidateDigest:candidate.digest};}
    return this.publish(node,candidate,actor);
  }
  publish(node,candidate,actor) {
    const task=this.activeTask(node.task_id),session=this.ensureSession(node);
    ok(candidate.task_revision===task.input_revision&&candidate.generation===session.generation,'STALE_OUTPUT','Candidate is no longer current');
    ok(!this.one(`SELECT 1 FROM sm_workers WHERE node_id=? AND state IN ${busy}`,node.id),'WORKER_STILL_ACTIVE','Workers must be stopped');
    const resultId=uid('result'),contract={id:node.config.output.id,revision:node.config.output.revision,schemaHash:digest(node.config.output.body.schema)};
    this.exec('INSERT INTO sm_results VALUES(?,?,?,?,?,?,?,?,?,?)',resultId,node.id,task.id,task.input_revision,canonical(contract),candidate.data,candidate.digest,candidate.producer,actor.kind==='human'?actor.id:null,now());
    this.exec("UPDATE sm_nodes SET state='SUCCEEDED',version=version+1 WHERE id=?",node.id);
    this.exec('UPDATE sm_bot_task_sessions SET active_node_id=NULL WHERE id=?',session.id);
    this.event(task.id,'result.published',{nodeId:node.id,resultId,contract},actor);
    this.refreshReady(task.id);return {state:'SUCCEEDED',resultId};
  }
  worker(workerId) {
    const row=this.one('SELECT w.* FROM sm_workers w JOIN sm_tasks t ON t.id=w.task_id WHERE t.workstation_id=? AND w.id=?',this.workstationId,id(workerId));ok(row,'WORKER_NOT_FOUND','Worker not found',404);return row;
  }
  reserveWorker(input,actor) {
    fields(input,['nodeId','profile','writeAccess'],['nodeId','profile','writeAccess']);const node=this.node(input.nodeId);this.activeTask(node.task_id);this.nodeActor(node,actor);
    ok(node.state==='RUNNING','NODE_STATE_CONFLICT','Node is not running');ok(typeof input.writeAccess==='boolean','INVALID_INPUT','writeAccess must be boolean',400);
    const policy=node.config.cliPolicy;ok(policy.allowedProfiles.includes(input.profile),'WORKER_PROFILE_DENIED','Worker profile not allowed',403);
    const all=this.all('SELECT * FROM sm_workers WHERE node_id=?',node.id),active=all.filter(w=>['RESERVED','RUNNING','UNKNOWN'].includes(w.state));
    ok(all.length<policy.maxTotal,'CLI_TOTAL_LIMIT','Node total Worker budget exhausted');ok(active.length<policy.maxConcurrent,'CLI_CONCURRENCY_LIMIT','Node concurrency exhausted');
    const count=this.one(`SELECT COUNT(*) n FROM sm_workers w JOIN sm_tasks t ON t.id=w.task_id WHERE t.workstation_id=? AND w.state IN ${busy}`,this.workstationId).n;
    ok(count<this.one('SELECT max_workers FROM sm_workstations WHERE id=?',this.workstationId).max_workers,'WORKSTATION_CLI_LIMIT','Workstation concurrency exhausted');
    if(input.writeAccess)ok(!this.one(`SELECT 1 FROM sm_workers WHERE task_id=? AND write_access=1 AND state IN ${busy}`,node.task_id),'WORKSPACE_BUSY','Another Worker owns the task workspace');
    const workerId=uid('worker');this.exec('INSERT INTO sm_workers(id,node_id,task_id,profile,state,write_access,created_at) VALUES(?,?,?,?,?,?,?)',workerId,node.id,node.task_id,input.profile,'RESERVED',Number(input.writeAccess),now());
    this.event(node.task_id,'worker.reserved',{workerId,nodeId:node.id},actor);return this.worker(workerId);
  }
  workerReceipt(input,actor) {
    this.system(actor);fields(input,['workerId','state','externalId','confirmed'],['workerId','state','confirmed']);const worker=this.worker(input.workerId);
    ok(['RESERVED','RUNNING','UNKNOWN'].includes(worker.state),'WORKER_FINISHED','Worker is already terminal');
    ok(['RUNNING','UNKNOWN','STOPPED','FAILED'].includes(input.state),'INVALID_STATE','Unknown worker state',400);
    if(['STOPPED','FAILED'].includes(input.state))ok(input.confirmed===true,'STOP_NOT_CONFIRMED','A controller stop receipt is required');
    if(input.state==='RUNNING'){text(input.externalId,'externalId',256);ok(worker.state==='RESERVED','WORKER_STATE_CONFLICT','Cannot bind this worker');}
    this.exec('UPDATE sm_workers SET state=?,external_id=COALESCE(?,external_id) WHERE id=?',input.state,input.externalId??null,worker.id);
    this.event(worker.task_id,'worker.receipt',{workerId:worker.id,state:input.state},actor);return this.worker(worker.id);
  }
  detail(taskId) {
    const task=this.task(taskId),nodes=this.all('SELECT * FROM sm_nodes WHERE task_id=? ORDER BY rowid',taskId).map(row=>({...row,config:parse(row.config)}));
    return {task,workflow:parse(this.one('SELECT snapshot FROM sm_workflows WHERE task_id=?',taskId).snapshot),worktree:this.one('SELECT * FROM sm_worktrees WHERE task_id=?',taskId),room:this.room(taskId),nodes,
      participants:[...new Set(nodes.filter(n=>['READY','RUNNING','WAITING_HUMAN'].includes(n.state)).map(n=>n.bot_id))],
      sessions:this.all('SELECT * FROM sm_bot_task_sessions WHERE task_id=?',taskId),workers:this.all('SELECT * FROM sm_workers WHERE task_id=?',taskId),
      results:this.all('SELECT * FROM sm_results WHERE task_id=?',taskId).map(row=>({...row,data:parse(row.data),contract:parse(row.contract),producer:parse(row.producer)}))};
  }
  events(taskId,{afterSeq=0,limit=200}={}) {
    const room=this.room(taskId);integer(afterSeq,'afterSeq');integer(limit,'limit',1,500);
    const events=this.all('SELECT * FROM sm_events WHERE room_id=? AND seq>? ORDER BY seq LIMIT ?',room.id,afterSeq,limit).map(row=>({...row,payload:parse(row.payload)}));
    return {roomId:room.id,events,nextSeq:events.at(-1)?.seq??afterSeq,hasMore:(events.at(-1)?.seq??afterSeq)<room.next_seq-1};
  }
  context(nodeId) {
    const node=this.node(nodeId),task=this.task(node.task_id),session=this.one('SELECT * FROM sm_bot_task_sessions WHERE task_id=? AND bot_id=?',task.id,node.bot_id);
    const dependencies=node.config.dependsOn.map(key=>{
      const result=this.one('SELECT r.* FROM sm_results r JOIN sm_nodes n ON n.id=r.node_id WHERE n.task_id=? AND n.node_key=?',task.id,key);
      ok(result&&result.task_revision===task.input_revision,'DEPENDENCY_NOT_READY','A required immutable output is missing');return {...result,data:parse(result.data),contract:parse(result.contract)};
    });
    const cursor=this.one("SELECT seq FROM sm_cursors WHERE logical_session_id=? AND source='room'",session.id)?.seq??0;
    return {node,session,dependencies,memory:this.memory(node.config.soul.id,task.project_id),cursors:this.all('SELECT * FROM sm_cursors WHERE logical_session_id=?',session.id),
      unread:this.events(task.id,{afterSeq:cursor}).events.filter(e=>e.target===null||e.target==='room'||e.target===`bot:${node.bot_id}`)};
  }
  snapshot() {
    return {workstationId:this.workstationId,projects:this.all('SELECT * FROM sm_projects WHERE workstation_id=?',this.workstationId),repositories:this.all('SELECT * FROM sm_repositories WHERE workstation_id=?',this.workstationId),links:this.all('SELECT * FROM sm_project_repositories WHERE workstation_id=?',this.workstationId),
      catalog:this.all('SELECT * FROM sm_catalog WHERE workstation_id=? ORDER BY kind,id,revision',this.workstationId).map(row=>({...row,body:parse(row.body)})),
      tasks:this.all('SELECT * FROM sm_tasks WHERE workstation_id=? ORDER BY created_at,id',this.workstationId)};
  }
  portfolio() {
    return {workstationId:this.workstationId,projects:this.all('SELECT * FROM sm_projects WHERE workstation_id=?',this.workstationId).map(project=>({id:project.id,name:project.name,tasks:this.all('SELECT id,title,state,version FROM sm_tasks WHERE workstation_id=? AND project_id=?',this.workstationId,project.id).map(task=>({...task,nodes:this.all('SELECT node_key,bot_id,state FROM sm_nodes WHERE task_id=?',task.id)}))}))};
  }
}
