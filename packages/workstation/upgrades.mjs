import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { invariant, safePath, readJson, digest, version, walk } from '../contracts/index.mjs';
import { TOOLKIT_FILES, TOOLKIT_VERSION, toolkitSnapshot } from '../spec-toolkit/index.mjs';
import { planFiles } from './transactions.mjs';

export async function planUpgrade(root, toolkitRoot) {
  const folder = await safePath(root, '.workbench-tools', { missing: false });
  const manifest = version(await readJson(path.join(folder, 'manifest.json')));
  invariant(Array.isArray(manifest.files) && new Set(manifest.files.map(x => x.path)).size === manifest.files.length, 'INVALID_TOOLKIT_MANIFEST', 'Duplicate or missing toolkit entries');
  invariant(manifest.files.every(x => TOOLKIT_FILES.includes(x.path)), 'TOOLKIT_CUSTOMIZED', 'Unknown toolkit files require manual review', 409);
  invariant((await walk(folder)).every(file => file === 'manifest.json' || manifest.files.some(x => x.path === file)), 'TOOLKIT_CUSTOMIZED', 'Unmanaged toolkit files must be reviewed before upgrade', 409);
  for (const entry of manifest.files) invariant(digest(await readFile(await safePath(folder, entry.path, { missing: false }))) === entry.sha256, 'TOOLKIT_CUSTOMIZED', `Locally modified toolkit file: ${entry.path}`, 409);
  const snapshot = await toolkitSnapshot(path.join(toolkitRoot, 'packages'));
  const files = snapshot.files.map(x => ({ path: `.workbench-tools/${x.path}`, content: x.content }));
  // Update the manifest last, so an interrupted upgrade is never advertised as complete.
  files.push({ path: '.workbench-tools/manifest.json', content: JSON.stringify(snapshot.manifest, null, 2) + '\n' });
  return planFiles(root, files, { kind: 'toolkit-upgrade', fromVersion: manifest.version, toVersion: TOOLKIT_VERSION, preserves: ['spec/', 'tests/', 'bdd.config.ts', 'playwright.config.ts', 'package.json', 'package-lock.json'] });
}
