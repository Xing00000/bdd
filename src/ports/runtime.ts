export type BrowserBinding={sessionId:string;contextRef:string;pageId:string;bindingSeq?:number};
export type BrowserAttachment=BrowserBinding&{id:string;playwrightEndpoint:string};
export type BrowserEvent={type:string;sessionId:string;contextRef:string;pageId:string;payload:Record<string,unknown>;image?:Buffer};
export type BrowserInput={type:string;[key:string]:unknown};
export interface BrowserRuntimePort{
 create(input:{projectId?:string;workspaceRef?:string;targetUrl?:string;httpCredentials?:{username:string;password:string}}):Promise<BrowserAttachment>;
 attachment(sessionId:string):BrowserAttachment;
 input(sessionId:string,input:BrowserInput):Promise<void>;
 subscribe(sessionId:string,listener:(event:BrowserEvent)=>void):()=>void;
 startRecording(sessionId:string):Promise<{recordingId:string}>;
 stopRecording(sessionId:string):Promise<{recordingId:string;rawText:string;actions:unknown[]}>;
 addAssertion(sessionId:string,input:{locator:string;assertionType:string;expected:string}):Promise<void>;
 closeSession(sessionId:string):Promise<void>;close():Promise<void>;
}
export interface TerminalRuntimePort{
 create(input:{workspaceRef:string;cols?:number;rows?:number;command?:{file:string;args:string[]}}):Promise<{id:string}>;
 hasSession(id:string):boolean;
 input(id:string,data:string):void;resize(id:string,cols:number,rows:number):void;
 subscribe(id:string,listener:(event:{type:string;data?:string;exitCode?:number})=>void):()=>void;
 closeTerminal(id:string):void;close():void;
}
export interface TargetDatabasePort{
 schema(file:string):Promise<unknown>;
 query(file:string,sql:string,params?:unknown[]):Promise<{columns:string[];rows:Record<string,unknown>[];changes?:number}>;
 close():Promise<void>;
}
