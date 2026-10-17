export type StepDefinitionFile = { path?: string; rawText: string };
export type SourceCase = {
  id?: string; sourceCaseId?: string; scenarioId?: string; scenarioKey?: string; scenario_key?: string;
  caseId?: string; caseKey?: string; case_key?: string; testKey?: string; requirementKey?: string;
  [key: string]: unknown;
};
export type GenerationOptions = { root: string; artifactRoot: string; llm?: { baseUrl: string; apiKey: string; model: string } };
export type GenerationInput = { feature: string; stepDefinitions: string | StepDefinitionFile | StepDefinitionFile[]; sourceCases: SourceCase[] };
export type GenerationResult = { rawText: string; manifest: Record<string, any>; files: { path: string; rawText: string }[]; specPath: string };
export type LlmInput = { gherkin: string; context?: unknown };
export type CompletionInput = LlmInput & { sd: string; skeleton: string; skeletonManifest?: Record<string, unknown> };
export type LlmResult = {
  status: 'completed' | 'needs_input'; rawText?: string; questions: string[];
  files?: { path: string; rawText: string }[]; mappings?: { testKey: string; scenarioId: string; caseId: string }[];
  usage?: Record<string, unknown>; proposalOnly: true;
};
