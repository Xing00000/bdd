export interface RunnerVersion { id: string; document_id: string; raw_text: string; raw_sha256: string; file_name?: string; test_manifest_json?: string | null }
export interface DiscoveredTest { testKey: string; project: string; file: string; titlePath: string[]; qualified: string; expectedStatus: string }
export interface PreparedRun { directory: string; config: string; configSha256: string; selection: string; selectionSha256: string; tests: DiscoveredTest[]; selected: DiscoveredTest[]; materializations: {versionId: string; rawSha256: string; materializedSha256: string; file: string; transformation: string | null}[] }
export interface TestRunnerPort {
  prepare(runId: string, versions: RunnerVersion[], expectedKeys?: string[], independent?: boolean): Promise<PreparedRun>;
  execute(runId: string, prepared: PreparedRun, token: string, recordingSecrets?: Record<string,string>): Promise<{code: number; stdout: string; stderr: string}>;
  close(): Promise<void>;
}
