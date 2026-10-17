import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTargetDatabase } from './target-app.js';

export type FixtureEnvironment = {
  root: string; metadataFile: string; targetDb: string; targetRepo: string;
  password: string; sourceRef: string; targetPort: number; env: Record<string, string>;
};
export async function initializeFixtureEnvironment(options: { workspaceRoot?: string; root?: string; password?: string; targetPort?: number } = {}): Promise<FixtureEnvironment> {
  const workspaceRoot = await realpath(options.workspaceRoot ?? process.cwd());
  const root = path.resolve(options.root ?? path.join(workspaceRoot, '.test-fixtures'));
  const relation = path.relative(workspaceRoot, root);
  if (relation !== '.test-fixtures' && !relation.startsWith('.test-fixtures' + path.sep))
    throw new Error('Fixture setup only accepts a dedicated .test-fixtures directory inside this workspace');
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  const realRelation = path.relative(workspaceRoot, realRoot);
  if (realRelation.startsWith('..') || path.isAbsolute(realRelation)) throw new Error('Fixture directory cannot escape the workspace through a symlink');
  const metadataFile = path.join(root, 'metadata.e2e.sqlite'), targetDb = path.join(root, 'target.e2e.sqlite'), targetRepo = path.join(root, 'target-repo');
  const secretFile = path.join(root, 'target-password');
  for (const target of [metadataFile, targetDb, targetRepo, secretFile, path.join(root, 'product.env')]) {
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Dedicated fixture files/repository cannot be symbolic links'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let password = options.password ?? process.env.WB_TARGET_PASSWORD;
  if (!password) {
    if (existsSync(secretFile)) password = (await readFile(secretFile, 'utf8')).trim();
    else { password = randomBytes(24).toString('base64url'); await writeFile(secretFile, password + '\n', { flag: 'wx', mode: 0o600 }); }
  }
  initializeTargetDatabase(targetDb);
  if (!existsSync(targetRepo)) {
    await mkdir(targetRepo);
    const playwrightCli = path.join(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');
    if (!existsSync(playwrightCli)) throw new Error('Install the approved Playwright dependency before initializing the target CI repository');
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'workbench-dedicated-target-ci', version: '0.1.0', private: true, type: 'module', scripts: { test: 'node ci.mjs' } }, null, 2) + '\n',
      '.gitignore': 'ci-results.json\ntest-results/\nplaywright-report/\n',
      'playwright.config.ts': `export default {testDir:'.',testMatch:'**/*.spec.ts',workers:1,retries:0,forbidOnly:true,timeout:180000,reporter:'json',use:{baseURL:process.env.WB_BASE_URL,launchOptions:{chromiumSandbox:true}}};\n`,
      'ci.mjs': `import {spawnSync} from 'node:child_process';\nimport {readdirSync} from 'node:fs';\nimport path from 'node:path';\nfunction specs(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.name.startsWith('.')||entry.name==='node_modules'||entry.name==='test-results'?[]:entry.isDirectory()?specs(path.join(directory,entry.name)):entry.name.endsWith('.spec.ts')?[path.join(directory,entry.name)]:[]);}\nif(!specs(process.cwd()).length){console.error('CI_NOT_RUN: no saved standard spec.ts in this commit');process.exit(2);}\nfor(const key of ['WB_BASE_URL','WB_RUN_ID','WB_TARGET_BASE_URL','WB_TARGET_PASSWORD'])if(!process.env[key]){console.error('CI_NOT_RUN: missing '+key);process.exit(2);}\nconst args=[${JSON.stringify(playwrightCli)},'test','--config',process.env.WB_CI_CONFIG??'playwright.config.ts'];if(process.env.WB_CI_TEST_LIST)args.push('--test-list',process.env.WB_CI_TEST_LIST);if(process.env.WB_CI_PROJECT)args.push('--project',process.env.WB_CI_PROJECT);const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});\nif(result.error)console.error(result.error.message);\nprocess.exit(result.status??1);\n`,
      'README.md': '# 專用 target Git／CI fixture\n\n此 repository 僅供本機產品驗收使用。工作台明確保存後，CI 於固定 commit 執行其中實際 spec.ts。空清單、缺少 managed run 環境或測試失敗均不會通過；不安裝套件、不 push。獨立錄製腳本不會自動加入此 repository。\n',
    };
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(targetRepo, name), content, { flag: 'wx' });
    execFileSync('git', ['init', '-b', 'main', targetRepo], { stdio: 'pipe' });
    execFileSync('git', ['-C', targetRepo, 'add', '--', ...Object.keys(files)], { stdio: 'pipe' });
    execFileSync('git', ['-C', targetRepo, '-c', 'user.name=Workbench Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-m', 'Initialize dedicated target CI fixture'], { stdio: 'pipe' });
  }
  const sourceRef = execFileSync('git', ['-C', targetRepo, 'rev-parse', '--verify', 'HEAD^{commit}'], { encoding: 'utf8' }).trim();
  const targetPort = options.targetPort ?? 4311;
  const env = {
    WB_BASE_URL: process.env.WB_BASE_URL ?? 'http://127.0.0.1:4310',
    WB_TARGET_BASE_URL: process.env.WB_TARGET_BASE_URL ?? `http://127.0.0.1:${targetPort}`,
    WB_METADATA_DB: metadataFile, WB_TARGET_DB: targetDb, WB_TARGET_REPO: targetRepo,
    WB_TARGET_PASSWORD: password, WB_SOURCE_REF: sourceRef,
  };
  // This file contains a fixture-only secret; never print or commit its contents.
  await writeFile(path.join(root, 'product.env'), Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  return { root, metadataFile, targetDb, targetRepo, password, sourceRef, targetPort, env };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await initializeFixtureEnvironment();
  console.log(JSON.stringify({ root: fixture.root, metadataFile: fixture.metadataFile, targetDb: fixture.targetDb, targetRepo: fixture.targetRepo, sourceRef: fixture.sourceRef, environmentFile: path.join(fixture.root, 'product.env'), metadataStatus: existsSync(fixture.metadataFile) ? 'exists; core owns migrations' : 'pending core migrations', targetWebsite: fixture.env.WB_TARGET_BASE_URL }, null, 2));
}
