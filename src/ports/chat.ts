export interface ChatSettings {
 codexExecutable:string;
 copilotExecutable:string;
 copilotArgs:string[];
 model:string;
 timeoutMs:number;
}
export interface ChatRuntime {
 reply(input:{roomId:string;threadId:string|null;text:string;settings:ChatSettings;onThread:(id:string)=>Promise<void>}):Promise<string>;
 compact(input:{roomId:string;threadId:string;settings:ChatSettings}):Promise<void>;
 close():Promise<void>;
}
