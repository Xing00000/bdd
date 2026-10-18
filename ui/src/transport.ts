export const bindingKeys=['runId','testDefinitionId','caseResultId','sessionId','contextRef','pageId','bindingSeq'] as const;
export function sameRunBinding(frame:Record<string,unknown>,current:Record<string,unknown>):boolean{
  return bindingKeys.every(key=>frame[key]!==undefined&&frame[key]!==null&&String(frame[key])===String(current[key]));
}
export function newerFrame(frame:any,previous:any):boolean{
  if(!previous)return true;
  if(frame.sessionId!==previous.sessionId||frame.contextRef!==previous.contextRef)return true;
  const next=frame.payload?.frameSequence,prior=previous.payload?.frameSequence;
  return !Number.isFinite(next)||!Number.isFinite(prior)||next>prior;
}
export function viewportPoint(bounds:{left:number;top:number;width:number;height:number},viewport:{width:number;height:number},point:{x:number;y:number}){
  if(viewport.width<=0||viewport.height<=0||bounds.width<=0||bounds.height<=0)return null;
  const scale=Math.min(bounds.width/viewport.width,bounds.height/viewport.height);
  const x=(point.x-bounds.left-(bounds.width-viewport.width*scale)/2)/scale;
  const y=(point.y-bounds.top-(bounds.height-viewport.height*scale)/2)/scale;
  return x>=0&&y>=0&&x<viewport.width&&y<viewport.height?{x,y}:null;
}
