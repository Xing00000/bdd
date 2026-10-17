export const productEnvironmentKeys=['WB_BASE_URL','WB_TARGET_BASE_URL','WB_METADATA_DB','WB_TARGET_DB','WB_TARGET_PASSWORD','WB_SOURCE_REF','WB_TARGET_REPO'] as const;
export function missingProductEnvironment(env:NodeJS.ProcessEnv=process.env){return productEnvironmentKeys.filter(key=>!env[key]);}
export function requireProductEnvironment(){
  const missing=missingProductEnvironment();
  if(missing.length){const error=new Error('PRODUCT_ENVIRONMENT_BLOCKED: '+missing.join(', '));error.name='ProductEnvironmentBlockedError';throw error;}
}
