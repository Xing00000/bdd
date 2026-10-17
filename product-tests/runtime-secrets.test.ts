import test from 'node:test';
import assert from 'node:assert/strict';
import { allowlistedRecordingSecretResolver, resolveRecordingSecrets, requiredRecordingSecretAliases } from '../src/adapters/runtime/secrets.js';
import { emitRecording } from '../src/adapters/runtime/recorder.js';

test('required recording secret aliases come from explicit action references and literal TypeScript access only', () => {
  const raw = "secret('WB_SECRET_CALL'); process.env.WB_SECRET_MEMBER; process.env['WB_SECRET_BRACKET']; process.env.PATH;";
  assert.deepEqual(requiredRecordingSecretAliases(raw, [{ value: { kind: 'secretRef', key: 'WB_SECRET_ACTION' } }]), ['WB_SECRET_ACTION', 'WB_SECRET_BRACKET', 'WB_SECRET_CALL', 'WB_SECRET_MEMBER']);
  const emitted = emitRecording([{ kind: 'navigate', pageId: 'page', url: 'https://example.test/' }, { kind: 'fill', pageId: 'page', locator: { kind: 'testId', value: 'password' }, value: { kind: 'secretRef', key: 'WB_SECRET_GENERATED' } }]);
  assert.deepEqual(requiredRecordingSecretAliases(emitted, []), ['WB_SECRET_GENERATED']);
  assert.throws(() => requiredRecordingSecretAliases("secret('AWS_SECRET_ACCESS_KEY')", []), { code: 'RECORDING_SECRET_BINDING_INVALID' });
  for (const script of ["secret(alias)", "process.env[key]", "process['env']['WB_SECRET_' + suffix]", 'const env = process.env; env.WB_SECRET_ALIAS;']) {
    assert.throws(() => requiredRecordingSecretAliases(script, []), { code: 'RECORDING_SECRET_DYNAMIC_ALIAS' });
  }
});

test('recording secret resolution returns only explicitly required aliases through an allowlisted registry', async () => {
  const calls: string[] = [];
  const resolve = allowlistedRecordingSecretResolver({ 'fixture-credential': async ({ projectId }) => { calls.push(projectId); return 'unit-fixture-value'; } });
  const result = await resolveRecordingSecrets({ projectId: 'project-1', requiredAliases: ['WB_SECRET_ABC', 'WB_SECRET_ABC'], bindings: [{ alias: 'WB_SECRET_ABC', secretRef: 'fixture-credential' }], resolve });
  assert.deepEqual(result, { WB_SECRET_ABC: 'unit-fixture-value' });
  assert.deepEqual(calls, ['project-1']);
  assert.equal(await resolve('process.env.AWS_SECRET_ACCESS_KEY', { projectId: 'project-1' }), undefined);
  assert.equal(await resolve('toString', { projectId: 'project-1' }), undefined);
});

test('secret binding preflight rejects missing, unexpected, duplicated and raw-value bindings before consulting a resolver', async () => {
  let calls = 0;
  const base = { projectId: 'project-1', requiredAliases: ['WB_SECRET_ABC'], resolve: async () => { calls++; return 'fixture'; } };
  await assert.rejects(resolveRecordingSecrets(base), { code: 'RECORDING_SECRET_REQUIRED' });
  await assert.rejects(resolveRecordingSecrets({ ...base, bindings: [{ alias: 'WB_SECRET_OTHER', secretRef: 'fixture' }] }), { code: 'RECORDING_SECRET_BINDING_INVALID' });
  await assert.rejects(resolveRecordingSecrets({ ...base, bindings: [{ alias: 'WB_SECRET_ABC', secretRef: 'fixture' }, { alias: 'WB_SECRET_ABC', secretRef: 'fixture' }] }), { code: 'RECORDING_SECRET_BINDING_INVALID' });
  await assert.rejects(resolveRecordingSecrets({ ...base, bindings: [{ alias: 'WB_SECRET_ABC', secretRef: 'fixture', value: 'must-not-persist' }] }), { code: 'RECORDING_SECRET_BINDING_INVALID' });
  await assert.rejects(resolveRecordingSecrets({ ...base, requiredAliases: ['OPENAI_API_KEY'] }), { code: 'RECORDING_SECRET_BINDING_INVALID' });
  assert.equal(calls, 0);
});

test('secret resolver absence, unknown references and provider errors fail closed without leaking provider values', async () => {
  const input = { projectId: 'project-1', requiredAliases: ['WB_SECRET_ABC'], bindings: [{ alias: 'WB_SECRET_ABC', secretRef: 'fixture' }] };
  await assert.rejects(resolveRecordingSecrets(input), { code: 'RECORDING_SECRET_RESOLVER_UNAVAILABLE' });
  await assert.rejects(resolveRecordingSecrets({ ...input, resolve: allowlistedRecordingSecretResolver({}) }), { code: 'RECORDING_SECRET_UNAVAILABLE' });
  await assert.rejects(resolveRecordingSecrets({ ...input, resolve: async () => { throw Error('private-provider-value'); } }), error => {
    assert.equal((error as { code: string }).code, 'RECORDING_SECRET_UNAVAILABLE');
    assert.ok(!String(error).includes('private-provider-value'));
    return true;
  });
  assert.deepEqual(await resolveRecordingSecrets({ projectId: 'project-1', requiredAliases: [] }), {});
});
