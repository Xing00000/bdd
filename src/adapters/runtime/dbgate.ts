export type DbGateOptions={url:string;username:string;password:string;connectionName:string;databaseFile:string};
export function dbgateUrl(value:string):string{
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('DbGate requires an HTTP(S) URL without embedded credentials');
 return url.href;
}
export function dbgateFromEnvironment(env:NodeJS.ProcessEnv):DbGateOptions|undefined{
 if(!env.WB_DBGATE_URL)return undefined;
 const url=dbgateUrl(env.WB_DBGATE_URL);
 if(!env.WB_DBGATE_LOGIN||!env.WB_DBGATE_PASSWORD||!env.WB_DBGATE_CONNECTION_NAME||!env.WB_DBGATE_DATABASE_FILE)throw Error('DbGate credentials, connection name and database file must be supplied to the server environment');
 return {url,username:env.WB_DBGATE_LOGIN,password:env.WB_DBGATE_PASSWORD,connectionName:env.WB_DBGATE_CONNECTION_NAME,databaseFile:env.WB_DBGATE_DATABASE_FILE};
}
