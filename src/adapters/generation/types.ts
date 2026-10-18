export type StepDefinitionFile = { path?: string; rawText: string };
export type SourceCase = {
  id?: string; sourceCaseId?: string; scenarioId?: string; scenarioKey?: string; scenario_key?: string;
  caseId?: string; caseKey?: string; case_key?: string; testKey?: string; requirementKey?: string;
  [key: string]: unknown;
};
export type LlmOptions = { executable: string; model?: string };
export type TerminalContext={projectId:string;requirementId:string;featureId:string};
export type TerminalSessionInfo=TerminalContext&{terminalId:string};
export type WorkflowAgentProfile={id:string;name:string;prompt:string;cliCommand:{id:string;name:string;executable:string;args:string[]};skill:{id:string;name:string;instructions:string}|null};
export type GenerationOptions = { root: string; artifactRoot: string; llm?: LlmOptions; terminal?:import('../../ports/runtime.ts').TerminalRuntimePort;onTerminal?:(event:TerminalContext&{terminalId:string;workspaceRef:string})=>void };
export type GenerationInput = { requirementKey:string; featureKey:string; sd:string; feature: string; stepDefinitions: string | StepDefinitionFile | StepDefinitionFile[]; sourceCases: SourceCase[] };
export type GenerationResult = { rawText: string; manifest: Record<string, any>; files: { path: string; rawText: string }[]; specPath: string };
export type LlmInput = { gherkin: string; context?: unknown;terminalContext?:TerminalContext;agent?:WorkflowAgentProfile };
export type CompletionInput = LlmInput & { sd: string; skeleton: string; skeletonManifest?: Record<string, unknown> };
export type LlmResult = {
  status: 'completed' | 'needs_input'; rawText?: string; questions: string[];
  files?: { path: string; rawText: string }[]; mappings?: { testKey: string; scenarioId: string; caseId: string }[];
  terminal?: TerminalSessionInfo; usage?: Record<string, unknown>; proposalOnly: true;
};
