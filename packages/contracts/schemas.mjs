import { invariant, identity } from './index.mjs';

const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const commit = { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' };
const text = { type: 'string', minLength: 1, maxLength: 2000 };
const array = (items, extra = {}) => ({ type: 'array', items, ...extra });
const object = (properties, required = Object.keys(properties), extra = {}) => ({ type: 'object', properties, required, additionalProperties: false, ...extra });
const command = array({ type: 'string', maxLength: 4000 }, { minItems: 1, maxItems: 80 });
const reviewRecord = object({ digest: hash, confirmedBy: { type: 'string', minLength: 1, maxLength: 120 }, confirmedAt: { type: 'string', format: 'date-time' } });
const root = value => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...value });
export const schemas = Object.freeze({
  workbench: root(object({
    schemaVersion: { const: 1 }, specRepositoryId: identifier,
    layout: object({ specRoot: { const: 'spec' }, testsRoot: { const: 'tests' }, reportsRoot: { const: 'reports' }, projectsRoot: { const: 'projects' } }),
    projects: array(object({ id: identifier, path: { type: 'string', pattern: '^projects/[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' } })),
    execution: object({ featureIsolation: { const: 'process' }, install: { anyOf: [command, { type: 'null' }] }, prepare: array(command), teardown: array(command), timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 }, globalTimeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 },
      environment: object({ WB_TARGET_BASE_URL: text, NODE_ENV: text, TZ: text }, []),
      service: object({ projectId: identifier, command, healthUrl: text }) }, ['featureIsolation']),
    reports: object({ storage: { const: 'git' }, publishMode: { const: 'explicit' } })
  })),
  requirement: root(object({ schemaVersion: { const: 1 }, id: identifier, title: text, features: array(identifier, { uniqueItems: true }) })),
  feature: root(object({ schemaVersion: { const: 1 }, id: identifier, requirementId: identifier, title: text,
    projectIds: array(identifier, { uniqueItems: true }), caseIds: array(identifier, { minItems: 1, uniqueItems: true }),
    profiles: array({ enum: ['chromium', 'firefox', 'webkit'] }, { minItems: 1, uniqueItems: true }) })),
  review: root(object({ schemaVersion: { const: 1 }, features: { type: 'object', propertyNames: identifier,
    additionalProperties: object({ gherkin: reviewRecord, sd: reviewRecord, tests: reviewRecord }, []) } })),
  operation: root(object({ schemaVersion: { const: 1 }, operationId: identifier, repositoryId: identifier, operation: text,
    expected: { type: 'object', properties: { head: { anyOf: [commit, { type: 'null' }] }, branch: { anyOf: [text, { type: 'null' }] }, fingerprint: hash } },
    input: { type: 'object' }, target: object({ kind: { enum: ['spec', 'project'] }, projectId: identifier }, ['kind'])
  }, ['schemaVersion', 'operationId', 'repositoryId', 'operation', 'input'])),
  manifest: root(object({ schemaVersion: { const: 1 }, runId: identifier, requirementId: identifier, featureId: identifier, testedSpecCommit: commit,
    artifacts: array(object({ path: text, size: { type: 'integer', minimum: 0 }, sha256: hash }))
  }, undefined, { additionalProperties: true }))
});
// Small validator for the exact schema vocabulary above; no code execution or remote refs.
function check(schema, value, location) {
  if (schema.anyOf) return schema.anyOf.some(s => check(s, value, location).length === 0) ? [] : [`${location}: no allowed variant matches`];
  const errors = [];
  const fail = message => errors.push(`${location}: ${message}`);
  if (Object.hasOwn(schema, 'const') && identity(value) !== identity(schema.const)) fail('constant mismatch');
  if (schema.enum && !schema.enum.some(v => identity(v) === identity(value))) fail('value not in enum');
  const matchesType = !schema.type || ({ object: value !== null && typeof value === 'object' && !Array.isArray(value), array: Array.isArray(value), string: typeof value === 'string', integer: Number.isInteger(value), number: typeof value === 'number' && Number.isFinite(value), boolean: typeof value === 'boolean', null: value === null })[schema.type];
  if (!matchesType) return [...errors, `${location}: expected ${schema.type}`];
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail('too short');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('too long');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('pattern mismatch');
    if (schema.format === 'date-time' && (!/^\d{4}-\d\d-\d\dT/.test(value) || Number.isNaN(Date.parse(value)))) fail('invalid date-time');
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('below minimum');
    if (schema.maximum !== undefined && value > schema.maximum) fail('above maximum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
    if (schema.uniqueItems && new Set(value.map(identity)).size !== value.length) fail('duplicate items');
    if (schema.items) value.forEach((v, i) => errors.push(...check(schema.items, v, `${location}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.propertyNames) errors.push(...check(schema.propertyNames, key, `${location} key`));
      const property = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : null;
      if (property) errors.push(...check(property, v, `${location}.${key}`));
      else if (schema.additionalProperties === false) fail(`unknown property ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...check(schema.additionalProperties, v, `${location}.${key}`));
    }
  }
  return errors;
}
export function validateContract(name, value) {
  invariant(Object.hasOwn(schemas, name), 'UNKNOWN_CONTRACT', name);
  const errors = check(schemas[name], value, name);
  invariant(errors.length === 0, 'CONTRACT_INVALID', errors.slice(0, 12).join('; ')); return value;
}
