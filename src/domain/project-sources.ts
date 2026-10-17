import {fail} from './errors.ts';
export type ProjectSource={projectId:string;sourceRef:string;resolvedCommit:string;[key:string]:unknown};

/** Read immutable source baselines, including the former single-project format. */
export function projectSources(value:any,linkedProjectIds:string[]):ProjectSource[]{
 const entries=Object.hasOwn(value,'projects')?value.projects:linkedProjectIds.length===1&&typeof value.sourceRef==='string'&&typeof value.resolvedCommit==='string'?[{...value,projectId:linkedProjectIds[0]}]:null;
 if(!Array.isArray(entries)||entries.length!==linkedProjectIds.length||new Set(entries.map(p=>p?.projectId)).size!==entries.length||entries.some(p=>!p||!linkedProjectIds.includes(p.projectId)||typeof p.sourceRef!=='string'||!p.sourceRef.trim()||typeof p.resolvedCommit!=='string'||!/^[0-9a-f]{40,64}$/.test(p.resolvedCommit)))fail(409,'SOURCE_BASELINE_INVALID','Source baseline must identify every linked project and immutable commit');
 return entries;
}
