export interface ChatSettings {
 codexExecutable:string;
 copilotExecutable:string;
 copilotArgs:string[];
 model:string;
 timeoutMs:number;
}
export interface ChatRuntime {
 models(settings:ChatSettings):Promise<ChatModel[]>;
 reply(input:{roomId:string;threadId:string|null;text:string;settings:ChatSettings;onDelta?:(delta:string)=>void;onThread:(id:string)=>Promise<void>}):Promise<string>;
 compact(input:{roomId:string;threadId:string;settings:ChatSettings}):Promise<void>;
 close():Promise<void>;
}
export interface ChatModel {id:string;name:string;selectable:boolean;}
