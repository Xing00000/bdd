import type {Page,TestInfo} from '@playwright/test';
export function designDecisionScenario(page:Page,info:TestInfo,options?:{real?:boolean}):AsyncGenerator<{phase:string},void,unknown>;
