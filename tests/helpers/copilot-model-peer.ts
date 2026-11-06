import {copilotChatPeer} from './copilot-chat-peer.ts';

// ACP catalog/transport evidence only, not model inference.
export async function copilotModelPeer(directory:string,models:unknown,{authenticated=true,hang=false}={}){
 return copilotChatPeer(directory,{models,authenticated,...(hang?{hangMethods:['session/new']}:{})});
}
