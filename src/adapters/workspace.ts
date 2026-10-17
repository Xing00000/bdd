import { mkdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
export function createWorkspaceAdapter(root: string, dataRoot: string) {
  const within = (base: string, file: string) => { const rel=path.relative(base,file); return rel==='' || (!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)); };
  async function existing(ref: string) {
    const actual=await realpath(path.resolve(ref));
    if(!within(await realpath(root),actual) || !(await stat(actual)).isDirectory()) throw Object.assign(new Error('Workspace must be an existing directory within this cloud repository'),{statusCode:400,code:'INVALID_WORKSPACE'});
    return actual;
  }
  async function stageDirectory(projectId: string, stage: string) {
    if(!/^[\w-]+$/.test(projectId)||!['GHERKIN','SD','TESTS','IMPLEMENTATION','VERIFICATION','VERIFIED'].includes(stage)) throw new Error('Invalid stage directory');
    const directory=path.join(dataRoot,'workspaces',projectId,stage.toLowerCase());
    await mkdir(directory,{recursive:true,mode:0o700}); return directory;
  }
  async function sourceFile(projectId:string) { return path.join(await stageDirectory(projectId,'IMPLEMENTATION'),'source.ts'); }
  return {
    existing, stageDirectory,
    async readSource(projectId:string) { const file=await sourceFile(projectId); let rawText='';try{rawText=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return {path:'source.ts',rawText,sha256:createHash('sha256').update(rawText).digest('hex')}; },
    async saveSource(projectId:string,rawText:string) { await writeFile(await sourceFile(projectId),rawText,{mode:0o600});return this.readSource(projectId); },
    async resolveSource(sourceRef:string,workspaceRef:string) {
      if(!sourceRef||sourceRef.startsWith('-')||sourceRef.includes('\0'))throw Object.assign(new Error('sourceRef must identify an existing commit'),{statusCode:422,code:'INVALID_SOURCE_REF'});
      let resolvedCommit:string|undefined;
      for(const repo of [await existing(workspaceRef),root]) {try {resolvedCommit=(await exec('git',['-C',repo,'rev-parse','--verify',`${sourceRef}^{commit}`],{maxBuffer:1024*1024})).stdout.trim();break;}catch{}}
      if(!resolvedCommit)throw Object.assign(new Error('sourceRef does not resolve to a cloud Git commit'),{statusCode:422,code:'INVALID_SOURCE_REF'});
      return {sourceRef,resolvedCommit};
    },
    async saveBundle(key:string,files:{path:string;rawText:string}[]) {
      if(!/^[\w-]+$/.test(key))throw new Error('Invalid bundle key');const directory=path.join(dataRoot,'bundles',key);await mkdir(directory,{recursive:true});
      for(const file of files){const destination=path.resolve(directory,file.path);if(!within(directory,destination)||destination===directory)throw new Error('Bundle path escape');await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,file.rawText,{mode:0o600});}return directory;
    }
  };
}
