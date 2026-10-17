import test from 'node:test';
import assert from 'node:assert/strict';
import {dbgateFromEnvironment,dbgateUrl} from '../../src/adapters/runtime/dbgate.ts';
test('DbGate requires explicit credentials and never embeds them in its public URL',()=>{
 assert.equal(dbgateFromEnvironment({}),undefined);
 assert.throws(()=>dbgateFromEnvironment({WB_DBGATE_URL:'http://localhost:3000'}));
 for(const url of ['file:///data/db','javascript:alert(1)','http://login:secret@localhost'])assert.throws(()=>dbgateUrl(url));
 const configuration=dbgateFromEnvironment({WB_DBGATE_URL:'http://localhost:3000',WB_DBGATE_LOGIN:'test-user',WB_DBGATE_PASSWORD:'test-secret',WB_DBGATE_CONNECTION_NAME:'target',WB_DBGATE_DATABASE_FILE:'/fixture/target.sqlite'});
 assert.deepEqual(configuration,{url:'http://localhost:3000/',username:'test-user',password:'test-secret',connectionName:'target',databaseFile:'/fixture/target.sqlite'});
});
