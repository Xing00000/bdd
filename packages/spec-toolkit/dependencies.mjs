/** Spec Repo dependency identity and isolated materialization; never Project dependencies. */
import path from 'node:path';
import { constants } from 'node:fs';
import { cp, readFile, readdir, lstat, rm, readlink, realpath } from 'node:fs/promises';
import { digest, identity, invariant, exists, safePath, readJson, writeJson, relativePath } from '../contracts/index.mjs';

export const dependencyReceiptPath = '.runtime/node-dependencies.json';
export const specToolBinaries = ['bddgen','playwright','tsc'];
export const nodeRuntime = () => ({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch});
export const npmInstallCommand = locked => ['npm',locked?'ci':'install','--ignore-scripts','--no-audit','--no-fund'];

export async function dependencyInputs(root) {
  const files=[{path:'package.json',content:await readFile(await safePath(root,'package.json',{missing:false}))}];
  if(await exists(await safePath(root,'package-lock.json')))files.push({path:'package-lock.json',content:await readFile(await safePath(root,'package-lock.json'))});
  const pkg=JSON.parse(files[0].content),paths=new Set();
  for(const value of Object.values({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}))if(typeof value==='string'&&/^(file|link):/.test(value))paths.add(value.replace(/^(file|link):/,''));
  const workspaces=Array.isArray(pkg.workspaces)?pkg.workspaces:pkg.workspaces?.packages??[];
  for(const pattern of workspaces) {
    const prefix=pattern.split(/[*?{[]/)[0].replace(/\/$/,'');
    invariant(prefix,'LOCAL_DEPENDENCY_PATH','Workspace dependencies need a directory inside the Spec Repo');paths.add(prefix);
  }
  const seen=new Set(files.map(file=>file.path));
  async function add(relative) {
    relative=relative.replace(/^\.\//,'');relativePath(relative);
    if(relative.split('/').some(name=>['node_modules','.git','.runtime','.generated','dist','build','target'].includes(name)||/^\.env(?:\.|$)/.test(name)))return;
    const file=await safePath(root,relative,{missing:false}),stat=await lstat(file);
    if(stat.isDirectory())for(const entry of await readdir(file))await add(`${relative}/${entry}`);
    else {invariant(stat.isFile(),'LOCAL_DEPENDENCY_PATH','Local dependencies must contain regular files');if(!seen.has(relative)){files.push({path:relative,content:await readFile(file)});seen.add(relative);}}
  }
  for(const relative of paths)await add(relative);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}

export async function dependencyDefinition(root) {
  const inputs=await dependencyInputs(root);
  return {runtime:nodeRuntime(),inputs:inputs.map(file=>[file.path,digest(file.content)])};
}

export async function installedDependencies(root) {
  const file=await safePath(root,dependencyReceiptPath);if(!await exists(file))return null;
  const receipt=await readJson(file),definition=await dependencyDefinition(root);
  invariant(receipt.key===identity(receipt.definition),'DEPENDENCY_RECEIPT_INVALID','Spec Repo dependency receipt failed integrity validation');
  if(receipt.key!==identity(definition))return null;
  for(const name of specToolBinaries)if(!await exists(path.join(root,'node_modules','.bin',name)))return null;
  return receipt;
}

export async function recordDependencies(root,command,requestedKey) {
  const definition=await dependencyDefinition(root),receipt={key:identity(definition),requestedKey,command,definition,installedAt:new Date().toISOString()};
  for(const name of specToolBinaries)invariant(await exists(path.join(root,'node_modules','.bin',name)),'DEPENDENCY_BINARY_MISSING',`Missing installed tool: ${name}`);
  await writeJson(await safePath(root,dependencyReceiptPath),receipt);return receipt;
}

export async function materializeDependencies(source,destination) {
  const receipt=await installedDependencies(source);
  invariant(receipt,'DEPENDENCIES_CHANGED','Installed Spec Repo dependencies no longer match their manifests',409);
  invariant(receipt.key===identity(await dependencyDefinition(destination)),'DEPENDENCIES_CHANGED','Dependency manifests differ from the installed Spec Repo environment',409);
  if((await installedDependencies(destination))?.key===receipt.key)return receipt;
  const target=await safePath(destination,'node_modules');
  const destinationRoot=await realpath(destination);
  await rm(await safePath(destination,dependencyReceiptPath),{force:true});
  await rm(target,{recursive:true,force:true});
  await cp(await safePath(source,'node_modules',{missing:false}),target,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
  async function checkLinks(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isSymbolicLink()) {
        const resolved=path.resolve(directory,await readlink(file)),relative=path.relative(destinationRoot,resolved);
        invariant(relative!== '..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative),'DEPENDENCY_LINK_OUTSIDE_ENVIRONMENT','A dependency link escapes the isolated Spec Repo environment');
      } else if(entry.isDirectory())await checkLinks(file);
    }
  }
  await checkLinks(target);
  await writeJson(await safePath(destination,dependencyReceiptPath),receipt);return receipt;
}

export async function reuseForExecution(root,command) {
  const receipt=await installedDependencies(root);if(!receipt)return null;
  // Audit/funding output does not change installed packages or lifecycle-script policy.
  const normalize=argv=>argv.filter(arg=>!['--no-audit','--no-fund'].includes(arg));
  if(command&&identity(normalize(command))!==identity(normalize(receipt.command)))return null;
  return receipt;
}
