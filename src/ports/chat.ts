export type AcpProvider='copilot'|'kiro';
export interface ChatSettings {
 codexExecutable:string;
 acpProvider?:AcpProvider;
 copilotExecutable:string;
 copilotArgs:string[];
 kiroExecutable?:string;
 kiroArgs?:string[];
 model:string;
 timeoutMs:number;
}
export interface ChatRuntime {
 models(settings:ChatSettings):Promise<ChatModel[]>;
 warmup?(settings:ChatSettings):Promise<void>;
 reply(input:{roomId:string;threadId:string|null;text:string;settings:ChatSettings;onDelta?:(delta:string)=>void;onThread:(id:string)=>Promise<void>}):Promise<string>;
 compact(input:{roomId:string;threadId:string;settings:ChatSettings}):Promise<void>;
 close():Promise<void>;
}
export interface ChatModel {id:string;name:string;selectable:boolean;}
