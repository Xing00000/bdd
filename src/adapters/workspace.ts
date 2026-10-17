import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export function createWorkspaceAdapter(root: string, dataRoot: string) {
  const within = (base: string, file: string) => { const rel=path.relative(base,file); return rel==='' || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)); };
  async function existing(ref: string) {
    if(!path.isAbsolute(ref))throw Object.assign(new Error('Project directory must be an absolute local path'),{statusCode:400,code:'INVALID_WORKSPACE'});
    const actual=await realpath(ref);
    if(!(await stat(actual)).isDirectory()) throw Object.assign(new Error('Project directory must exist'),{statusCode:400,code:'INVALID_WORKSPACE'});
    return actual;
  }
  async function stageDirectory(projectId: string, stage: string) {
    if(!/^[\w-]+$/.test(projectId)||!['GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED'].includes(stage)) throw new Error('Invalid stage directory');
    const directory=path.join(dataRoot,'workspaces',projectId,stage.toLowerCase());
    await mkdir(directory,{recursive:true,mode:0o700}); return directory;
  }
  async function sourceFile(workspaceRef:string,relative='source.ts') {
    const base=await existing(workspaceRef),file=path.resolve(base,relative);
    if(path.isAbsolute(relative)||!within(base,file)||file===base||relative.split(/[\/\\]/).includes('.git'))throw Object.assign(new Error('Source file must stay inside the project'),{statusCode:400,code:'INVALID_SOURCE_PATH'});
    if(!within(base,await realpath(path.dirname(file))))throw Object.assign(new Error('Source parent escapes project'),{statusCode:400,code:'INVALID_SOURCE_PATH'});
    try{if(!within(base,await realpath(file)))throw Object.assign(new Error('Source symlink escapes project'),{statusCode:400,code:'INVALID_SOURCE_PATH'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return file;
  }
  return {
    existing, stageDirectory,
    async readSource(workspaceRef:string,relative='source.ts') { const file=await sourceFile(workspaceRef,relative); let rawText='';try{rawText=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return {path:relative,rawText,sha256:createHash('sha256').update(rawText).digest('hex')}; },
    async saveSource(workspaceRef:string,rawText:string,relative='source.ts') { await writeFile(await sourceFile(workspaceRef,relative),rawText,{mode:0o600});return this.readSource(workspaceRef,relative); },
    async resolveSource(sourceRef:string,workspaceRef:string,projectId?:string) {
      if(!sourceRef||sourceRef.startsWith('-')||sourceRef.includes('\0'))throw Object.assign(new Error('sourceRef must identify an existing commit'),{statusCode:422,code:'INVALID_SOURCE_REF'});
      let resolvedCommit:string|undefined,repositoryRef=await existing(workspaceRef);
      try {const top=(await exec('git',['-C',repositoryRef,'rev-parse','--show-toplevel'],{maxBuffer:1024*1024})).stdout.trim();if(await realpath(top)!==await realpath(repositoryRef))throw new Error('Workspace is not a Git repository root');resolvedCommit=(await exec('git',['-C',repositoryRef,'rev-parse','--verify',`${sourceRef}^{commit}`],{maxBuffer:1024*1024})).stdout.trim();}catch{}
      if(!resolvedCommit)throw Object.assign(new Error('sourceRef does not resolve to a cloud Git commit'),{statusCode:422,code:'INVALID_SOURCE_REF'});
      const changes=(await exec('git',['-C',repositoryRef,'diff','--name-only',resolvedCommit,'--'],{maxBuffer:16*1024*1024})).stdout;
      const untracked=(await exec('git',['-C',repositoryRef,'ls-files','--others','--exclude-standard'],{maxBuffer:16*1024*1024})).stdout;
      if(changes.trim()||untracked.trim())throw Object.assign(new Error('Commit the project changes before pinning this revision'),{statusCode:409,code:'SOURCE_NOT_IN_COMMIT'});
      const sourceTree=(await exec('git',['-C',repositoryRef,'rev-parse',`${resolvedCommit}^{tree}`],{maxBuffer:1024*1024})).stdout.trim();
      return {sourceRef,resolvedCommit,repositoryRef,sourceTree};
    },
    async saveBundle(key:string,files:{path:string;rawText:string}[]) {
      if(!/^[\w-]+$/.test(key))throw new Error('Invalid bundle key');const directory=path.join(dataRoot,'bundles',key);await mkdir(directory,{recursive:true});
      for(const file of files){const destination=path.resolve(directory,file.path);if(!within(directory,destination)||destination===directory)throw new Error('Bundle path escape');await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,file.rawText,{mode:0o600});}return directory;
    }
  };
}
