/** Canonical case identity. Legacy '=' spellings are normalized at this boundary. */
import { id, invariant } from '../contracts/index.mjs';

export const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const fields = new Set(['req', 'feature', 'case', 'level']);

function executionContext() {
  const req = process.env.WB_REQUIREMENT_ID, feature = process.env.WB_FEATURE_ID;
  if (req === undefined && feature === undefined) return undefined;
  return { req: id(req, 'WB_REQUIREMENT_ID'), feature: id(feature, 'WB_FEATURE_ID') };
}

export function parseTags(tags, required = [], context = executionContext()) {
  invariant(Array.isArray(tags), 'INVALID_TAGS', 'Test tags must be an array');
  const values = Object.create(null);
  for (const tag of tags) {
    const name = typeof tag === 'string' ? tag : tag?.name;
    invariant(typeof name === 'string', 'INVALID_TAG', 'A test tag must have a name');
    const match = /^@([a-z][a-z0-9_-]*)([:=])(.+)$/.exec(name);
    invariant(match || !/^@(req|feature|case|level)(?:[:=]|$)/.test(name), 'INVALID_TAG', `Malformed test identity tag: ${name}`);
    if (!match || !fields.has(match[1])) continue; // Gherkin scope/filter tags are opaque.
    const key = match[1], value = id(match[3], `tag ${key}`);
    invariant(!Object.hasOwn(values, key), 'DUPLICATE_TAG_KEY', `Duplicate test identity tag: ${key}`);
    values[key] = value;
  }
  if (context) for (const key of ['req', 'feature']) {
    const value = id(context[key], `execution ${key}`);
    invariant(!Object.hasOwn(values, key) || values[key] === value, 'TAG_IDENTITY_MISMATCH', `Declared ${key} differs from the selected execution`);
    values[key] = value;
  }
  for (const key of required) invariant(Object.hasOwn(values, key), 'MISSING_TAG_KEY', `Missing test identity tag: ${key}`);
  return values;
}

export function testIdentity(test, requirementId, featureId) {
  const rows = [...test.title.matchAll(/\[case[:=]([A-Za-z0-9][A-Za-z0-9_-]{0,79})\]/g)].map(match => match[1]);
  invariant(rows.length <= 1, 'CASE_ID_CONFLICT', 'A generated test must identify exactly one Examples row');
  // Examples identify concrete rows; inherited Scenario tags identify the outline.
  const tags = rows.length ? (test.tags ?? []).filter(tag=>!/^@case[:=]/.test(typeof tag==='string'?tag:tag?.name??'')) : test.tags ?? [];
  const values = parseTags(tags, ['req', 'feature'], {req: requirementId, feature: featureId});
  const caseId = rows[0] ?? values.case;
  invariant(caseId, 'MISSING_TAG_KEY', `Exactly one stable case ID is required: ${test.title}`);
  return { requirementId: values.req, featureId: values.feature, caseId: id(caseId, 'caseId') };
}

export function caseSelection(ids) {
  invariant(Array.isArray(ids) && ids.length && new Set(ids).size === ids.length, 'INVALID_SELECTION', 'Select unique existing case IDs');
  const choices = ids.map(value => id(value)).join('|');
  return `(?:@case[:=](?:${choices})(?![A-Za-z0-9_-])|\\[case[:=](?:${choices})\\])`;
}
