import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const maintainedDocs = ['README.md', 'docs/architecture/workstation.md', 'docs/operations.md', 'docs/compatibility.md'];
const retiredDocs = new Set(['docs/architecture/git-workstation-v1.md', 'docs/architecture/git-workstation-v2.md']);
// The annotated MCP spec does not yet have a lossless tracked generator; do not erase it.
const retainedAnnotatedSpec = 'spec/REQ-WB-001/mcp/mcp.feature.spec.ts';
export function generatedPath(file) {
  return /^(deploy|dist|node_modules|verification|test-results|playwright-report|\.generated|\.runtime|\.test-fixtures)\//.test(file)
    || /^spec\/.*\.feature\.spec\.js$/.test(file)
    || /^spec\/.*\.feature\.spec\.ts$/.test(file) && file !== retainedAnnotatedSpec;
}
const present = async file => { try { await access(file); return true; } catch { return false; } };
function headings(text) {
  const duplicates = new Map(), anchors = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
    const number = duplicates.get(slug) ?? 0; duplicates.set(slug, number + 1);
    anchors.add(slug + (number ? `-${number}` : ''));
  }
  return anchors;
}
export async function checkRepository(root, options = {}) {
  const tracked = options.trackedFiles ?? execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const docs = options.docs ?? maintainedDocs, errors = [];
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const file of tracked) {
    if (generatedPath(file)) errors.push(`Generated output must not be tracked: ${file}`);
    if (retiredDocs.has(file)) errors.push(`Superseded operational document must not be tracked: ${file}`);
  }
  const knownScript = (name, owner) => {
    if (!Object.hasOwn(packageJson.scripts ?? {}, name)) errors.push(`${owner}: unknown npm script ${name}`);
  };
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    for (const match of command.matchAll(/\bnpm run\s+([\w:-]+)/g)) knownScript(match[1], `package.json:${name}`);
    for (const match of command.matchAll(/(?:^|&&\s*|;\s*)node\s+([\w./-]+\.(?:mjs|js|ts))/g)) {
      // dist/ is intentionally absent in a clean source checkout; its build is checked separately.
      if (!match[1].startsWith('dist/') && !await present(path.join(root, match[1]))) errors.push(`package.json:${name}: missing CLI entry ${match[1]}`);
    }
  }
  for (const doc of docs) {
    if (!await present(path.join(root, doc))) { errors.push(`Missing maintained document: ${doc}`); continue; }
    const text = await readFile(path.join(root, doc), 'utf8');
    for (const match of text.matchAll(/\bnpm run\s+([\w:-]+)/g)) knownScript(match[1], doc);
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const url = match[1]; if (/^[A-Za-z][\w+.-]*:/.test(url)) continue;
      let target, fragment;
      try { [target, fragment] = url.split('#').map(x => decodeURIComponent(x)); }
      catch { errors.push(`${doc}: invalid link encoding ${url}`); continue; }
      const file = target ? path.resolve(root, path.dirname(doc), target) : path.resolve(root, doc);
      const relative = path.relative(path.resolve(root), file);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { errors.push(`${doc}: link escapes repository ${url}`); continue; }
      if (!await present(file)) errors.push(`${doc}: broken relative link ${url}`);
      else if (fragment && file.endsWith('.md') && !headings(await readFile(file, 'utf8')).has(fragment)) errors.push(`${doc}: missing heading ${url}`);
    }
  }
  return { ok: errors.length === 0, trackedFiles: tracked.length, maintainedDocuments: docs.length, errors };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkRepository(fileURLToPath(new URL('../', import.meta.url)));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
