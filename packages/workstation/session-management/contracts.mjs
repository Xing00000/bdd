import {createHash} from 'node:crypto';

export class SessionError extends Error {
  constructor(code, message, status = 409) { super(message); this.name='SessionError'; this.code=code; this.status=status; this.statusCode=status; }
}
export function requireThat(ok, code, message, status=409) { if(!ok) throw new SessionError(code,message,status); }
export function text(value, name, max=2000) {
  requireThat(typeof value==='string' && value.trim().length>0 && value.length<=max, 'INVALID_INPUT', `${name} must be nonempty text (max ${max})`,400);
  return value;
}
export function identifier(value) {
  requireThat(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),'INVALID_ID','Invalid identifier',400); return value;
}
export function integer(value,name,min=0,max=1000000) {
  requireThat(Number.isSafeInteger(value)&&value>=min&&value<=max,'INVALID_INPUT',`Invalid ${name}`,400); return value;
}
export function object(value) { return value!==null && typeof value==='object' && !Array.isArray(value); }
export function canonical(value) {
  if(value===null || typeof value==='boolean' || typeof value==='string') return JSON.stringify(value);
  if(typeof value==='number') {requireThat(Number.isFinite(value),'INVALID_JSON','Non-finite number',400);return JSON.stringify(value);}
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  requireThat(object(value),'INVALID_JSON','Expected JSON data',400);
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function fields(value, allowed, required=[]) {
  requireThat(object(value),'INVALID_INPUT','Expected an object',400);
  for(const key of Object.keys(value)) requireThat(allowed.includes(key),'UNKNOWN_FIELD',`Unknown field: ${key}`,400);
  for(const key of required) requireThat(Object.hasOwn(value,key),'MISSING_FIELD',`Missing field: ${key}`,400);
}

// Deliberately closed JSON Schema subset. Unsupported constraints fail at registration;
// they are never silently ignored. No external references or executable expressions.
const common=['$schema','$id','title','description','type','enum','const'];
const keywords={object:['properties','required','additionalProperties'],array:['items','minItems','maxItems'],string:['minLength','maxLength'],integer:['minimum','maximum'],number:['minimum','maximum'],boolean:[],null:[]};
export function checkSchema(schema, depth=0, budget={nodes:0}) {
  requireThat(++budget.nodes<=1000&&depth<=16,'SCHEMA_LIMIT','Schema is too complex',400);
  requireThat(object(schema)&&Object.hasOwn(keywords,schema.type),'UNSUPPORTED_SCHEMA','A supported explicit type is required',400);
  fields(schema,[...common,...keywords[schema.type]]);
  if(schema.$schema!==undefined) requireThat(schema.$schema==='https://json-schema.org/draft/2020-12/schema','UNSUPPORTED_SCHEMA','Only the 2020-12 dialect is accepted',400);
  if(schema.enum!==undefined) requireThat(Array.isArray(schema.enum)&&schema.enum.length>0&&schema.enum.length<=100,'INVALID_SCHEMA','Invalid enum',400);
  for(const pair of [['minLength','maxLength'],['minItems','maxItems'],['minimum','maximum']]) {
    for(const name of pair) if(schema[name]!==undefined) {
      requireThat(Number.isFinite(schema[name]),'INVALID_SCHEMA',`Invalid ${name}`,400);
      if(name!=='minimum'&&name!=='maximum') integer(schema[name],name,0,262144);
    }
    if(schema[pair[0]]!==undefined&&schema[pair[1]]!==undefined) requireThat(schema[pair[0]]<=schema[pair[1]],'INVALID_SCHEMA','Inverted bounds',400);
  }
  if(schema.type==='object') {
    requireThat(schema.additionalProperties===false&&object(schema.properties)&&Array.isArray(schema.required),'INVALID_SCHEMA','Object schemas require properties, required and additionalProperties:false',400);
    requireThat(new Set(schema.required).size===schema.required.length&&schema.required.every(k=>Object.hasOwn(schema.properties,k)),'INVALID_SCHEMA','Invalid required fields',400);
    for(const [name,sub] of Object.entries(schema.properties)) {requireThat(!['__proto__','constructor','prototype'].includes(name),'INVALID_SCHEMA','Reserved property',400);checkSchema(sub,depth+1,budget);}
  }
  if(schema.type==='array') checkSchema(schema.items,depth+1,budget);
  return schema;
}
export function validateOutput(schema,value,where='$') {
  const fail=message=>{throw new SessionError('OUTPUT_CONTRACT_VIOLATION',`${where}: ${message}`,422);};
  if(schema.type==='object') {
    if(!object(value)) fail('expected object');
    for(const key of schema.required) if(!Object.hasOwn(value,key)) fail(`missing ${key}`);
    for(const key of Object.keys(value)) {if(!Object.hasOwn(schema.properties,key)) fail(`unknown ${key}`);validateOutput(schema.properties[key],value[key],`${where}.${key}`);}
  } else if(schema.type==='array') {
    if(!Array.isArray(value)) fail('expected array');
    if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??262144)) fail('array length');
    value.forEach((v,i)=>validateOutput(schema.items,v,`${where}[${i}]`));
  } else if(schema.type==='null') {if(value!==null) fail('expected null');}
  else if(schema.type==='integer'||schema.type==='number') {
    if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isSafeInteger(value))) fail('expected number');
    if(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)) fail('number out of bounds');
  } else {
    if(typeof value!==schema.type) fail(`expected ${schema.type}`);
    if(schema.type==='string'&&([...value].length<(schema.minLength??0)||[...value].length>(schema.maxLength??262144))) fail('string length');
  }
  if(schema.enum&&!schema.enum.some(v=>canonical(v)===canonical(value))) fail('not an enum value');
  if(Object.hasOwn(schema,'const')&&canonical(schema.const)!==canonical(value)) fail('const mismatch');
  return value;
}
export function cliPolicy(value) {
  fields(value,['steps','allowedProfiles','maxConcurrent','maxTotal','maxTurns','timeoutMs'],['steps','allowedProfiles','maxConcurrent','maxTotal','maxTurns','timeoutMs']);
  requireThat(Array.isArray(value.steps)&&value.steps.length>0&&value.steps.length<=32&&value.steps.every(v=>typeof v==='string'&&v.length>0&&v.length<=80),'INVALID_POLICY','Invalid CLI steps',400);
  requireThat(Array.isArray(value.allowedProfiles)&&value.allowedProfiles.length<=32&&value.allowedProfiles.every(v=>typeof v==='string'&&v.length>0&&v.length<=128),'INVALID_POLICY','Invalid Worker profiles',400);
  integer(value.maxConcurrent,'maxConcurrent',0,16); integer(value.maxTotal,'maxTotal',0,1000);
  integer(value.maxTurns,'maxTurns',1,1000); integer(value.timeoutMs,'timeoutMs',1000,3600000);
  requireThat(value.maxConcurrent<=value.maxTotal,'INVALID_POLICY','Concurrency exceeds total',400);
  return value;
}
