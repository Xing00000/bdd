import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const skillSeedMarker='-- PLAYWRIGHT_BDD_SKILL_SEED';
const defaultCodexArgs=['--sandbox','workspace-write','--ask-for-approval','on-request','--no-alt-screen','--no-daemon'];
const initialCodexArgsMarker='__INITIAL_DEFAULT_CODEX_ARGS_JSON__';
const upgradeCodexInsertArgsMarker='__UPGRADE_INSERT_CODEX_ARGS_JSON__';
const upgradeCodexUpdateArgsMarker='__UPGRADE_UPDATE_CODEX_ARGS_JSON__';
const seedSections=['CLI','SKILL','AGENTS','ASSIGNMENTS','UPGRADE'] as const;

function sqlString(value:string):string{
 return `'${value.replaceAll("'","''")}'`;
}

function replaceExactlyOnce(value:string,marker:string,replacement:string,description:string):string{
 if(value.split(marker).length!==2)throw new Error(`The application seed must contain exactly one ${description} marker.`);
 return value.replace(marker,replacement);
}

function section(value:string,name:typeof seedSections[number]):string{
 const start=`-- APPLICATION_SEED:${name}:BEGIN`,end=`-- APPLICATION_SEED:${name}:END`;
 if(value.split(start).length!==2||value.split(end).length!==2)throw new Error(`The application seed must contain exactly one ${name} section.`);
 const contents=value.split(start)[1].split(end)[0].trim();
 if(!contents)throw new Error(`The application seed ${name} section is empty.`);
 return contents;
}

function renderedSeed(root:string):string{
 let template=readFileSync(new URL('./seed.sql',import.meta.url),'utf8');
 const instructions=readFileSync(join(root,'skills/playwright-bdd/SKILL.md'),'utf8');
 if(!instructions.trim()||instructions.includes('\0'))throw new Error('The checked-in Playwright-BDD Skill is empty or contains NUL.');
 const skillSeed=`INSERT OR IGNORE INTO llm_skills(id,name,instructions)\nVALUES(lower(hex(randomblob(16))),'Playwright BDD',${sqlString(instructions)});`;
 template=replaceExactlyOnce(template,skillSeedMarker,skillSeed,'Playwright-BDD Skill');
 const codexArgs=sqlString(JSON.stringify(defaultCodexArgs));
 template=replaceExactlyOnce(template,initialCodexArgsMarker,codexArgs,'initial Codex argv');
 template=replaceExactlyOnce(template,upgradeCodexInsertArgsMarker,codexArgs,'upgrade Codex insert argv');
 template=replaceExactlyOnce(template,upgradeCodexUpdateArgsMarker,codexArgs,'upgrade Codex update argv');
 for(const name of seedSections)section(template,name);
 return template;
}

export function renderApplicationSeedSql(root:string):string{
 const template=renderedSeed(root);
 return (['CLI','SKILL','AGENTS','ASSIGNMENTS'] as const).map(name=>section(template,name)).join('\n\n').trim()+'\n';
}

export function renderWorkflowAgentUpgradeSql(root:string):string{
 const template=renderedSeed(root);
 return (['SKILL','UPGRADE','AGENTS','ASSIGNMENTS'] as const).map(name=>section(template,name)).join('\n\n').trim()+'\n';
}
