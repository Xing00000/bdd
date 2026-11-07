import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionExecutionController} from '../../packages/workstation/session-management/execution-controller.mjs';
import {fixture,system} from './session-management-fixture.mjs';

function create(f,runTurn){
  const e=new SessionExecutionController({
    home:f.home,worktreeRoot:f.options.worktreeRoot,
    settings:async()=>({model:'test-model',codexExecutable:'/nonexistent'}),runTurn,
    supervisor:{send(){throw Error('unexpected supervisor send')},stop(){throw Error('unexpected supervisor stop')}}
  });
  return e;
}
const output={kind:'OUTPUT',data:{summary:'Checked requirement',accepted:true}};
const native=(id,disposition=output)=>async ({onEvent,nativeId})=>{
  const threadId=nativeId??id;
  if(!nativeId)onEvent({type:'thread.started',thread_id:threadId});
  onEvent({type:'turn.completed'});
  return {threadId,disposition};
};

test('real controller boundary: one frozen SA output advances SD, preserving task room and runtime generations',async t=>{
  const f=fixture();t.after(()=>f.close());f.create();f.ready();
  const turns=[];
  const runner=async args=>{
    turns.push({prompt:args.prompt,nativeId:args.nativeId});
    const response=await native('test-thread-'+turns.length)(args);
    return response;
  };
  const engine=create(f,runner);t.after(()=>engine.close());
  const before=f.m.detail('task-a').room.id;
  assert.deepEqual(engine.start('task-a'),{taskId:'task-a',queued:true});
  await engine.active.get('task-a');
  const d=f.m.detail('task-a');
  assert.equal(d.room.id,before);
  assert.equal(d.task.state,'WAITING_ACCEPTANCE');
  assert.deepEqual(d.nodes.map(n=>n.state),['SUCCEEDED','SUCCEEDED']);
  assert.equal(d.results.length,2);
  assert.equal(d.results[0].contract.id,'requirement-result');
  assert.equal(turns.length,2);
  assert.match(turns[1].prompt,/Checked requirement/);
  const ledger=engine.state('task-a');
  assert.equal(ledger.turns.length,2);
  assert.ok(ledger.turns.every(x=>x.state==='COMPLETED'));
  assert.ok(d.sessions.every(x=>x.generation===1));
});

test('human message arriving during turn delays final publication until a later SDK turn',async t=>{
  const f=fixture();t.after(()=>f.close());f.create();f.ready();
  let count=0;
  const runner=async args=>{
    count++;
    const result=await native('test-thread-'+count)(args);
    if(count===1)f.m.command('room.message',{taskId:'task-a',target:'bot:sa',text:'Use Session Cookie'},{requestId:'during-turn'});
    return result;
  };
  const engine=create(f,runner);t.after(()=>engine.close());
  engine.start('task-a');await engine.active.get('task-a');
  assert.equal(count,3); // SA yield, SA consumes correction, then SD
  const turns=engine.state('task-a').turns;
  assert.equal(turns[0].state,'WAITING');
  assert.equal(turns[1].state,'COMPLETED');
  assert.equal(turns[2].state,'COMPLETED');
  assert.equal(f.m.detail('task-a').results.length,2);
  assert.equal(f.m.detail('task-a').sessions.find(x=>x.bot_id==='sa').generation,1);
});

test('invalid output keeps node unfinished and blocks replay of uncertain native effects',async t=>{
  const f=fixture();t.after(()=>f.close());f.create();f.ready();
  const engine=create(f,native('bad-sdk-thread',{kind:'OUTPUT',data:{notAllowed:'x'}}));
  t.after(()=>engine.close());
  engine.start('task-a');
  await assert.rejects(engine.active.get('task-a'),/missing summary|unknown notAllowed|OUTPUT_CONTRACT/);
  const current=engine.state('task-a');
  assert.equal(current.turns[0].state,'UNKNOWN');
  assert.equal(f.m.detail('task-a').nodes[0].state,'RUNNING');
  assert.equal(f.m.detail('task-a').results.length,0);
  assert.throws(()=>engine.start('task-a'),/reconciled|TURN_RECONCILIATION_REQUIRED/);
});

test('missing native thread.started cannot be replaced by a fabricated SDK completion',async t=>{
  const f=fixture();t.after(()=>f.close());f.create();f.ready();
  const engine=create(f,async()=>({threadId:'invented-id',disposition:output}));
  t.after(()=>engine.close());
  engine.start('task-a');
  await assert.rejects(engine.active.get('task-a'),/SDK changed thread identity|SDK_THREAD|current native Session/);
  assert.equal(f.m.detail('task-a').results.length,0);
});

test('human approval gates next bot and preserves immutable result across generations',async t=>{
  const f=fixture({approval:true});t.after(()=>f.close());f.create();f.ready();
  let count=0;
  const engine=create(f,async args=>native('thread-'+(++count))(args));t.after(()=>engine.close());
  engine.start('task-a');await engine.active.get('task-a');
  const d=f.m.detail('task-a');
  assert.equal(d.nodes[0].state,'WAITING_HUMAN');assert.equal(d.nodes[1].state,'BLOCKED');
  assert.equal(d.results.length,0);
  const candidate=f.m.one('SELECT digest FROM sm_candidates WHERE node_id=?',d.nodes[0].id);
  f.m.command('node.approve',{nodeId:d.nodes[0].id,expectedVersion:f.m.node(d.nodes[0].id).version,candidateDigest:candidate.digest});
  engine.start('task-a');await engine.active.get('task-a');
  assert.equal(f.m.detail('task-a').nodes[1].state,'WAITING_HUMAN');
  assert.equal(f.m.detail('task-a').results.length,1);
});
