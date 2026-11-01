/** Friendly automation surface; the worker and UI share the same workflow policy. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkstation } from './service.mjs';
import { invariant, errorResult, id } from '../contracts/index.mjs';

export const workflowHelp = `BDD workflow CLI
  bdd workflow status [--repo <name|URL|id>] [--feature <REQ/feature>]
  bdd workflow next   [--repo <name|URL|id>] --feature <REQ/feature>
  bdd workflow run    [--repo <name|URL|id>] --feature <REQ/feature>
  bdd workflow regress [--repo <name|URL|id>] --spec <branch|tag|commit>
                       [--project <id=ref>]... [--batch <prepared-id>]
  bdd workflow regress [--repo <name|URL|id>] --rerun <batch-id>
  --install-consent <digest>  Explicit consent for the returned installation plan
  --timeout <seconds>        Wait limit (1–1800, default 1800)
  --json                     JSON is the default output; diagnostics use stderr

next never grants human approvals. It stops with AWAITING_REVIEW or installs only
with explicit plan consent. run repeats verification; regress uses fixed versions.
Exit: 0 success/status, 1 error or failed/unverified execution, 2 human review,
      3 installation consent required. Uses the same WB_HOME as the running UI.
`;

export function parseWorkflowArgs(argv) {
  const [verb, ...rest] = argv;
  invariant(['status','next','run','regress'].includes(verb), 'CLI_USAGE', workflowHelp, 400);
  const flags = {}, projects = {};
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if (name === '--json') continue;
    invariant(['--repo','--feature','--spec','--project','--batch','--rerun','--install-consent','--timeout'].includes(name), 'CLI_USAGE', `未知參數 ${name}`, 400);
    const value = rest[++i]; invariant(typeof value === 'string' && value && !value.startsWith('--'), 'CLI_USAGE', `${name} 需要值。`, 400);
    if (name === '--project') {
      const separator = value.indexOf('='); invariant(separator > 0 && separator < value.length - 1, 'CLI_USAGE', '--project 使用 id=ref。', 400);
      const key = id(value.slice(0,separator)); invariant(!Object.hasOwn(projects,key), 'CLI_USAGE', `重複產品 ${key}`, 400);
      Object.defineProperty(projects,key,{value:value.slice(separator+1),enumerable:true,writable:true});
    } else { invariant(!Object.hasOwn(flags,name), 'CLI_USAGE', `重複參數 ${name}`, 400); flags[name] = value; }
  }
  if (flags['--feature']) invariant(flags['--feature'].split('/').length === 2 && flags['--feature'].split('/').every(x => id(x)), 'CLI_USAGE', '--feature 使用 REQ/feature。', 400);
  if (flags['--install-consent']) invariant(/^[a-f0-9]{64}$/.test(flags['--install-consent']), 'CLI_USAGE', '安裝授權必須是回傳的計畫摘要。', 400);
  const timeout = Number(flags['--timeout'] ?? 1800);
  invariant(Number.isInteger(timeout) && timeout >= 1 && timeout <= 1800, 'CLI_USAGE', '--timeout 範圍為 1–1800 秒。', 400);
  if (verb !== 'regress') invariant(!flags['--spec']&&!flags['--rerun']&&!flags['--batch']&&!Object.keys(projects).length,'CLI_USAGE','版本與產品參數只用於 regress。',400);
  if (verb === 'regress') {
    invariant(!flags['--feature'],'CLI_USAGE','regress 執行所選規格的整庫測試；單功能請使用 run。',400);
    invariant(!flags['--rerun'] || !flags['--spec']&&!flags['--batch']&&!Object.keys(projects).length,'CLI_USAGE','--rerun 固定原始版本，不能同時覆寫版本。',400);
    invariant(flags['--spec'] || flags['--rerun'],'CLI_USAGE','請指定 --spec 或 --rerun。',400);
  }
  return { verb, flags, projects, timeoutMs: timeout*1000 };
}
export function resolveRepository(repositories, value, cwd = process.cwd()) {
  const normalize = url => String(url).replace(/\.git\/?$/,'').replace(/\/$/,'');
  const matches = value ? repositories.filter(r => r.id===value || r.title===value || normalize(r.remoteUrl)===normalize(value)
    || normalize(r.remoteUrl).split(/[/:]/).at(-1)===value)
    : repositories.filter(r => r.localPath && (cwd===r.localPath || cwd.startsWith(r.localPath+path.sep)));
  if (!value && !matches.length && repositories.length===1) return repositories[0];
  invariant(matches.length===1,'REPOSITORY_SELECTION_REQUIRED',`請用 --repo 明確選擇規格庫。可用：${repositories.map(r=>`${r.title} (${r.id})`).join(', ')}`,400);
  return matches[0];
}
export function workflowExitCode(command, result, error) {
  if (error) return error.code==='INSTALL_REQUIRED'?3:1;
  if (command==='status') return 0;
  if (result?.status==='AWAITING_REVIEW') return 2;
  if (command==='regress') return result?.status==='COMPLETED' && result?.outcome==='PASSED'?0:1;
  if (result?.status==='COMPLETE') return 0;
  return result?.testOutcome==='PASSED' && result?.verification==='VERIFIED'?0:1;
}
export async function workflowMain(argv, options) {
  let service, parsed;
  if (!argv.length || ['help','--help','-h'].includes(argv[0])) {process.stdout.write(workflowHelp);return;}
  try {
    parsed = parseWorkflowArgs(argv); service = await createWorkstation(options);
    const repository = resolveRepository(service.list(),parsed.flags['--repo']);
    const repositoryId = repository.id;
    if (parsed.verb==='status') {
      process.stdout.write(JSON.stringify(await service.workflow(repositoryId,parsed.flags['--feature']))+'\n'); return;
    }
    let input, operation;
    if (parsed.verb==='regress') {
      operation='regression.start'; input={specRef:parsed.flags['--spec'],projects:parsed.projects};
      if(parsed.flags['--rerun']) {
        const detail=await service.detail(repositoryId),batch=detail.regressions.find(b=>b.batchId===parsed.flags['--rerun']);
        invariant(batch,'REGRESSION_NOT_FOUND','找不到此規格庫的歷史回歸。',404);
        input={specRef:batch.testedSpecCommit,projects:Object.fromEntries(batch.projects.map(p=>[p.id,p.commit]))};
      }
      if(parsed.flags['--batch'])input.batchId=id(parsed.flags['--batch']);
    } else {
      const status=await service.workflow(repositoryId,parsed.flags['--feature']);
      invariant(status.workflows.length===1,'FEATURE_SELECTION_REQUIRED','請用 --feature REQ/feature 選擇一個功能。',400);
      const f=status.workflows[0];input={requirementId:f.requirementId,featureId:f.featureId};
      operation=parsed.verb==='next'?'workflow.next':'workflow.verify';
    }
    if(parsed.flags['--install-consent'])input.installConsent=parsed.flags['--install-consent'];
    const operationId=`OP-${randomUUID()}`;
    service.enqueue({schemaVersion:1,operationId,repositoryId,operation,input});
    const receipt=await service.wait(operationId,parsed.timeoutMs);
    process.exitCode=workflowExitCode(parsed.verb,receipt.result,receipt.error ?? (receipt.status!=='SUCCEEDED'?{code:receipt.status}:null));
    const output={schemaVersion:1,command:parsed.verb,repositoryId,operationId,status:receipt.status,result:receipt.result,error:receipt.error};
    if(receipt.error?.code==='INSTALL_REQUIRED')output.resume={...input,installConsent:receipt.error.details?.install?.digest,batchId:receipt.error.details?.install?.batchId};
    process.stdout.write(JSON.stringify(output)+'\n');
  } catch(error) {process.exitCode=workflowExitCode(parsed?.verb,null,error);process.stdout.write(JSON.stringify({status:'FAILED',error:errorResult(error)})+'\n');}
  finally {await service?.close();}
}
