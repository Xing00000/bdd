import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameChannel } from '../../src/http/frame-channel.js';
import { newerFrame } from '../../ui/src/transport.ts';

// Socket fixtures exercise transport ordering only; no browser pixels are synthesized as E2E evidence.
test('frame backpressure keeps the newest frame and never replays an older pending frame',()=>{
  const output:(string|Buffer)[]=[],socket={readyState:1,bufferedAmount:20,send:(value:string|Buffer)=>output.push(value)};
  const channel=createFrameChannel(10),frame=(n:number,runId?:string)=>({type:'browser.frame',sessionId:'s',contextRef:'c',pageId:'p',runId,image:Buffer.from([n]),payload:{frameSequence:n}});
  channel.send(socket,frame(1));channel.send(socket,frame(2));assert.equal(channel.pendingCount(),1);assert.equal(output.length,0);
  socket.bufferedAmount=0;channel.send(socket,frame(3));channel.flush();assert.equal(output.length,2);assert.equal(JSON.parse(String(output[0])).payload.frameSequence,3);assert.deepEqual(output[1],Buffer.from([3]));
  channel.send(socket,frame(2));channel.send(socket,frame(3));assert.equal(output.length,2);
  channel.send(socket,frame(3,'run'));assert.equal(output.length,4,'same pixel sequence for a distinct run binding still has a distinct header');
  socket.bufferedAmount=20;channel.send(socket,frame(4));socket.bufferedAmount=0;channel.flush();assert.equal(JSON.parse(String(output[4])).payload.frameSequence,4);assert.equal(channel.pendingCount(),0);
  socket.readyState=3;channel.send(socket,frame(5));assert.equal(channel.pendingCount(),0);
});

test('viewer sequence guard rejects duplicate and stale frames within the same context',()=>{
  const frame=(n:number)=>({sessionId:'s',contextRef:'c',payload:{frameSequence:n}});
  assert.equal(newerFrame(frame(2),frame(1)),true);assert.equal(newerFrame(frame(1),frame(2)),false);assert.equal(newerFrame(frame(2),frame(2)),false);
  assert.equal(newerFrame({...frame(1),contextRef:'new'},frame(2)),true);
});
