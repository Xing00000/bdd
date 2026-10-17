import { CoreError } from './errors.js';
import ts from 'typescript';

export type RecordingSecretBinding = { alias: string; secretRef: string };
export type RecordingSecretResolver = (secretRef: string, context: { projectId: string }) => Promise<string | undefined>;

const validAlias = (value: unknown): value is string => typeof value === 'string' && /^WB_SECRET_[A-Z0-9_]{1,112}$/.test(value);
function fail(code: string, message: string): never { throw new CoreError(422, code, message); }

/** Collect only statically declared recording aliases. Never evaluate source or
 * enumerate process.env. Dynamic accesses cannot establish a safe allowlist. */
export function requiredRecordingSecretAliases(rawText: string, actions: unknown): string[] {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    if (!validAlias(value)) fail('RECORDING_SECRET_BINDING_INVALID', 'Recording secret aliases must be static WB_SECRET_ names');
    aliases.add(value);
  };
  if (actions !== undefined && actions !== null && !Array.isArray(actions)) fail('RECORDING_SECRET_BINDING_INVALID', 'Recorded actions must be an array');
  for (const action of (actions ?? []) as unknown[]) {
    if (!action || typeof action !== 'object') continue;
    const value = (action as { value?: unknown }).value;
    if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'secretRef') add((value as { key?: unknown }).key);
  }
  const source = ts.createSourceFile('recording.spec.ts', rawText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const literal = (node: ts.Node | undefined): string | undefined => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const processEnv = (node: ts.Node): boolean => (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') || (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && literal(node.argumentExpression) === 'env');
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'secret') {
      if (node.arguments.length !== 1) fail('RECORDING_SECRET_DYNAMIC_ALIAS', 'secret() requires one static recording alias');
      const alias = literal(node.arguments[0]);
      if (alias === undefined) fail('RECORDING_SECRET_DYNAMIC_ALIAS', 'Computed recording secret aliases are not supported');
      add(alias);
    }
    if (processEnv(node)) {
      const parent = node.parent;
      let key: string | undefined;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) key = parent.name.text;
      else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        key = literal(parent.argumentExpression);
        if (key === undefined) {
          if (isGeneratedSecretHelperAccess(node)) return;
          fail('RECORDING_SECRET_DYNAMIC_ALIAS', 'Computed process.env access is not permitted in recording scripts');
        }
      }
      else fail('RECORDING_SECRET_DYNAMIC_ALIAS', 'Recording scripts must access named environment variables explicitly');
      if (key?.startsWith('WB_SECRET_')) add(key);
    }
    ts.forEachChild(node, visit);
  }
  // Our emitted helper is the sole dynamic process.env[key] access allowed;
  // its call sites are checked above. It has no additional executable body.
  function isGeneratedSecretHelperAccess(node: ts.Node): boolean {
    const parent = node.parent;
    if (!ts.isElementAccessExpression(parent) || parent.expression !== node || !ts.isIdentifier(parent.argumentExpression) || parent.argumentExpression.text !== 'key') return false;
    let ancestor: ts.Node | undefined = parent;
    while (ancestor && !ts.isFunctionDeclaration(ancestor)) ancestor = ancestor.parent;
    if (!ancestor || !ts.isFunctionDeclaration(ancestor) || ancestor.name?.text !== 'secret' || !ancestor.body || ancestor.parameters.length !== 1 || ancestor.parameters[0].name.getText(source) !== 'key') return false;
    const expected = ts.createSourceFile('helper.ts', 'function secret(key: string): string { const value = process.env[key]; if (value === undefined) throw new Error(`Missing recording secret: ${key}`); return value; }', ts.ScriptTarget.Latest, true);
    const fingerprint = (member: ts.Node): unknown => {
      if (ts.isIdentifier(member) || ts.isLiteralExpression(member) || ts.isNoSubstitutionTemplateLiteral(member)) return [member.kind, member.text];
      const children: unknown[] = []; ts.forEachChild(member, child => { children.push(fingerprint(child)); });
      return [member.kind, children];
    };
    return JSON.stringify(fingerprint(ancestor)) === JSON.stringify(fingerprint(expected.statements[0]));
  }
  visit(source);
  return [...aliases].sort();
}

/** Validates only references and calls an explicitly supplied trusted resolver.
 * No environment access, default provider, raw-value persistence, or fallback. */
export async function resolveRecordingSecrets(input: {
  projectId: string;
  requiredAliases: readonly string[];
  bindings?: unknown;
  resolve?: RecordingSecretResolver;
}): Promise<Record<string, string>> {
  if (typeof input.projectId !== 'string' || !input.projectId.trim()) fail('RECORDING_SECRET_BINDING_INVALID', 'A project identity is required for secret resolution');
  if (!Array.isArray(input.requiredAliases) || input.requiredAliases.some(alias => !validAlias(alias))) fail('RECORDING_SECRET_BINDING_INVALID', 'Recording secret aliases must use the WB_SECRET_ namespace');
  const required = new Set(input.requiredAliases);
  const bindings = input.bindings ?? [];
  if (!Array.isArray(bindings)) fail('RECORDING_SECRET_BINDING_INVALID', 'secretBindings must be an array of alias/secretRef references');
  const references = new Map<string, string>();
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).some(key => !['alias', 'secretRef'].includes(key))) fail('RECORDING_SECRET_BINDING_INVALID', 'A secret binding accepts alias and secretRef only; raw values are forbidden');
    const { alias, secretRef } = binding as Record<string, unknown>;
    if (!validAlias(alias) || typeof secretRef !== 'string' || !secretRef.trim() || secretRef.length > 256 || /[\r\n\0]/.test(secretRef)) fail('RECORDING_SECRET_BINDING_INVALID', 'Invalid recording secret reference');
    if (!required.has(alias)) fail('RECORDING_SECRET_BINDING_INVALID', `Secret alias ${alias} is not required by this script version`);
    if (references.has(alias)) fail('RECORDING_SECRET_BINDING_INVALID', `Duplicate secret binding for ${alias}`);
    references.set(alias, secretRef);
  }
  const missing = [...required].filter(alias => !references.has(alias));
  if (missing.length) fail('RECORDING_SECRET_REQUIRED', 'Explicit secret bindings are required for: ' + missing.join(', '));
  if (!required.size) return {};
  const resolver = input.resolve;
  if (!resolver) fail('RECORDING_SECRET_RESOLVER_UNAVAILABLE', 'No allowlisted recording secret resolver is configured');
  const resolved: Record<string, string> = {};
  for (const alias of required) {
    let value: unknown;
    try { value = await resolver(references.get(alias)!, { projectId: input.projectId }); }
    catch { fail('RECORDING_SECRET_UNAVAILABLE', `The configured secret reference could not be resolved for ${alias}`); }
    if (typeof value !== 'string' || !value.length) fail('RECORDING_SECRET_UNAVAILABLE', `No value is available for required alias ${alias}`);
    resolved[alias] = value;
  }
  return resolved;
}

/** Only the composition root creates this registry. A page/binding cannot select
 * an arbitrary environment variable by choosing a similarly named reference. */
export function allowlistedRecordingSecretResolver(registry: Readonly<Record<string, (context: { projectId: string }) => Promise<string | undefined> | string | undefined>>): RecordingSecretResolver {
  const entries = new Map(Object.entries(registry));
  return async (secretRef, context) => entries.has(secretRef) ? await entries.get(secretRef)!(context) : undefined;
}
