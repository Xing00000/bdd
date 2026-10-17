export class ApiError extends Error {
  constructor(readonly status:number,readonly body:any){super(body?.message??body?.error??body?.code??`HTTP ${status}`);}
}
export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch(path,{method:method??(body===undefined?'GET':'POST'),credentials:'same-origin',headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let value:any;try{value=text?JSON.parse(text):{};}catch{value={message:text.slice(0,500)||response.statusText};}
  if(!response.ok)throw new ApiError(response.status,value);return value;
}
export function items(value:any):any[]{return Array.isArray(value)?value:value?.items??value?.projects??value?.requirements??value?.connections??value?.recordings??value?.cases??[];}
export function errorText(error:unknown):string{
  if(error instanceof ApiError){const diagnostics=error.body?.diagnostics;return `${error.message}${Array.isArray(diagnostics)?'\n'+diagnostics.map((d:any)=>`${d.file??error.body.file??''}:${d.line??'?'}:${d.column??'?'} ${d.reason??d.message??''}`).join('\n'):''}`;}
  return error instanceof Error?error.message:String(error);
}
export function socketUrl(path:string){return `${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${path}`;}
export function pretty(value:any){return typeof value==='string'?value:JSON.stringify(value??{},null,2);}
export function short(value:any){return String(value??'未固定').slice(0,12);}
