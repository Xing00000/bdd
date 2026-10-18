import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import type { Core } from '../../application/core.ts';
import { validateSdFormat, sdGenerationTask } from '../../domain/sd-format.ts';
import { isWorkflowAgentStage, type WorkflowAgentStage } from '../../domain/workflow-agent-stages.ts';
import { parseTypeScript } from '../../domain/parsers.ts';
import { syntax } from '../generation/definitions.ts';
import { declaredIds } from '../generation/llm.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export type McpSessionContext = {
  sessionId: string;
  requirementId: string;
  featureId: string;
  projectId?: string | null;
  stage?: string;
  agentId?: string;
  agent?: any;
  proposalDir?: string;
  awaitConsumer?: () => Promise<void>;
  close: () => void;
};

export interface McpServerDependencies {
  core: Core;
  ext: any;
  workspace: any;
  runtime: any;
  generation: any;
  llmSettings?: any;
  workflowSettings?: any;
  metadataFile: string;
  emit: (event: any) => void;
}

const promptDefinitions = [
  {
    name: 'workbench_stage_prompt',
    description: 'Retrieve the database-configured stage Agent prompt, Skill instructions, and stage task guidance.',
    arguments: [
      { name: 'requirementId', description: 'Optional requirement ID (defaults to active MCP session)', required: false },
      { name: 'featureId', description: 'Optional feature ID (defaults to active MCP session)', required: false },
      { name: 'stage', description: 'Optional workflow stage: GHERKIN, SD, TESTS, or IMPLEMENTATION', required: false },
      { name: 'agentId', description: 'Optional assigned Agent ID', required: false },
    ],
  },
] as const;

const toolDefinitions = [
  {
    name: 'workbench_get_agent_prompt',
    description: 'Retrieve the database-configured Agent prompt, bound Skill instructions, and stage task guidance for the current or requested workflow stage.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        stage: { type: 'string', enum: ['GHERKIN', 'SD', 'TESTS', 'IMPLEMENTATION'] },
        agentId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_get_context',
    description: 'Query current requirement workflow stage, confirmed/draft Gherkin, SD, spec documents, linked workspaces, and pending questions.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_get_gherkin_structure',
    description: 'Query structured Gherkin scenarios, steps, Examples tables/rows, and scenario-to-case mappings.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        versionId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_list_project_files',
    description: 'List files inside a requirement-linked local workspace directory, rejecting out-of-bounds paths.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        projectId: { type: 'string' },
        directory: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_read_project_file',
    description: 'Read a file inside a requirement-linked local workspace directory, rejecting out-of-bounds or symlink-escaped paths.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        projectId: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_get_db_schema',
    description: 'Query actual SQLite schema (tables, columns, indexes, triggers) for target database connections linked to the requirement workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        projectId: { type: 'string' },
        connectionId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_submit_sd',
    description: 'Validate and submit a System Design (SD) Markdown proposal or needs_input questions for the current SD stage.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        status: { type: 'string', enum: ['completed', 'needs_input'] },
        rawText: { type: 'string' },
        questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['status'],
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_submit_test_completion',
    description: 'Validate mappings/types and submit a completed Playwright-BDD spec proposal or needs_input questions for the current TESTS stage.',
    inputSchema: {
      type: 'object',
      properties: {
        requirementId: { type: 'string' },
        featureId: { type: 'string' },
        status: { type: 'string', enum: ['completed', 'needs_input'] },
        rawText: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, rawText: { type: 'string' } },
            required: ['path', 'rawText'],
            additionalProperties: false,
          },
        },
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            properties: { testKey: { type: 'string' }, scenarioId: { type: 'string' }, caseId: { type: 'string' } },
            required: ['testKey', 'scenarioId', 'caseId'],
            additionalProperties: false,
          },
        },
        questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['status'],
      additionalProperties: false,
    },
  },
] as const;

export function createMcpServer(deps: McpServerDependencies) {
  const { core, ext, workspace, runtime, generation, metadataFile, emit } = deps;
  const sessions = new Map<string, McpSessionContext>();
  const questionsByFeature = new Map<string, string[]>();
  let latestSessionId: string | undefined;

  const featureKey = (requirementId: string, featureId: string) => `${requirementId}:${featureId}`;

  function createSession(input: Omit<McpSessionContext, 'sessionId' | 'close'> & { sessionId?: string }): McpSessionContext {
    const sessionId = input.sessionId ?? randomUUID();
    const session: McpSessionContext = { ...input, sessionId, close: () => closeSession(sessionId) };
    sessions.set(sessionId, session);
    latestSessionId = sessionId;
    return session;
  }

  function closeSession(sessionId: string) {
    sessions.delete(sessionId);
    if (latestSessionId === sessionId) {
      latestSessionId = [...sessions.keys()].at(-1);
    }
  }

  function getQuestions(requirementId: string, featureId: string): string[] {
    return questionsByFeature.get(featureKey(requirementId, featureId)) ?? [];
  }

  function setQuestions(requirementId: string, featureId: string, questions: string[]) {
    questionsByFeature.set(featureKey(requirementId, featureId), [...questions]);
  }

  function resolveSession(args: Record<string, any>, sessionIdHeader?: string): McpSessionContext | undefined {
    const requestedSessionId = typeof args?.sessionId === 'string' ? args.sessionId : sessionIdHeader;
    if (requestedSessionId && sessions.has(requestedSessionId)) return sessions.get(requestedSessionId);
    if (typeof args?.requirementId === 'string' && args.requirementId.trim()) {
      const matching = [...sessions.values()].reverse().find(s =>
        s.requirementId === args.requirementId && (!args.featureId || s.featureId === args.featureId));
      return matching;
    }
    if (!requestedSessionId && sessions.size === 1 && latestSessionId && sessions.has(latestSessionId)) {
      return sessions.get(latestSessionId);
    }
    return undefined;
  }

  async function resolveContext(args: Record<string, any>, session?: McpSessionContext) {
    const requirementId = typeof args.requirementId === 'string' && args.requirementId.trim()
      ? args.requirementId.trim()
      : session?.requirementId;
    const featureId = typeof args.featureId === 'string' && args.featureId.trim()
      ? args.featureId.trim()
      : session?.featureId;
    if (!requirementId) {
      throw Object.assign(new Error('requirementId is required'), { statusCode: 400, code: 'REQUIREMENT_REQUIRED' });
    }
    const current = await ext.current(requirementId, featureId);
    return { current, session };
  }

  async function publishProposalFiles(session: McpSessionContext | undefined, proposal: Record<string, unknown>) {
    if (!session?.proposalDir) return false;
    const proposalFile = path.join(session.proposalDir, 'proposal.json');
    const readyFile = path.join(session.proposalDir, 'proposal.ready');
    await writeFile(proposalFile, JSON.stringify(proposal, null, 2), { mode: 0o600 });
    await writeFile(readyFile, '', { mode: 0o600 });
    if (session.awaitConsumer) {
      await session.awaitConsumer();
      return true;
    }
    return false;
  }

  async function listWorkspaceFiles(workspaceRef: string, relativeDir = ''): Promise<string[]> {
    const base = await workspace.existing(workspaceRef);
    const cleaned = relativeDir.trim();
    const within = (rootDir: string, target: string) => {
      const rel = path.relative(rootDir, target);
      return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
    };
    if (path.isAbsolute(cleaned) || cleaned.split(/[\/\\]/).some(part => part === '..' || part === '.git')) {
      throw Object.assign(new Error('Workspace path must remain inside the registered project directory'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    const targetDir = path.resolve(base, cleaned || '.');
    if (!within(base, targetDir)) {
      throw Object.assign(new Error('Workspace path escapes project directory'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    let actualTarget: string;
    try {
      actualTarget = await realpath(targetDir);
    } catch {
      throw Object.assign(new Error('Workspace directory does not exist'), {
        statusCode: 404,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    if (!within(base, actualTarget) || !(await stat(actualTarget)).isDirectory()) {
      throw Object.assign(new Error('Workspace directory escapes project root'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    const maxDepth = 16;
    const maxFiles = 2000;
    const results: string[] = [];
    async function walk(currentDir: string, depth: number) {
      if (depth > maxDepth || results.length >= maxFiles) return;
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(currentDir, entry.name);
        let realFull: string;
        try {
          realFull = await realpath(full);
        } catch {
          continue;
        }
        if (!within(base, realFull)) continue;
        const rel = path.relative(base, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    }
    await walk(targetDir, 0);
    return results.sort();
  }

  async function readWorkspaceFile(workspaceRef: string, relativePath: string) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw Object.assign(new Error('File path is required'), { statusCode: 400, code: 'WORKSPACE_PATH_INVALID' });
    }
    const base = await workspace.existing(workspaceRef);
    const within = (rootDir: string, target: string) => {
      const rel = path.relative(rootDir, target);
      return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
    };
    const resolved = path.resolve(base, relativePath);
    if (path.isAbsolute(relativePath) || !within(base, resolved) || relativePath.split(/[\/\\]/).some(p => p === '..' || p === '.git')) {
      throw Object.assign(new Error('File path must stay inside the project workspace'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    let realParent: string;
    try {
      realParent = await realpath(path.dirname(resolved));
    } catch {
      throw Object.assign(new Error('File parent directory does not exist inside workspace'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    if (realParent !== base && !within(base, realParent)) {
      throw Object.assign(new Error('File parent escapes project workspace'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    let realFile: string;
    try {
      realFile = await realpath(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw Object.assign(new Error(`File not found in workspace: ${relativePath}`), {
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      }
      throw error;
    }
    const fileStat = await stat(realFile);
    if (!within(base, realFile) || !fileStat.isFile()) {
      throw Object.assign(new Error('File symlink escapes project workspace'), {
        statusCode: 400,
        code: 'WORKSPACE_PATH_INVALID',
      });
    }
    if (fileStat.size > 2 * 1024 * 1024) {
      throw Object.assign(new Error('Workspace file exceeds 2 MiB read limit'), {
        statusCode: 413,
        code: 'WORKSPACE_FILE_TOO_LARGE',
      });
    }
    const rawText = await readFile(realFile, 'utf8');
    return { path: relativePath, rawText, sha256: sha256(rawText) };
  }

  function toolSuccess(payload: Record<string, unknown>) {
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  function toolError(code: string, message: string, extra: Record<string, unknown> = {}) {
    const payload = { status: 'invalid', code, message, ...extra, error: { code, message, ...extra } };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  }

  async function resolveAgentPrompt(args: Record<string, any> = {}, session?: McpSessionContext) {
    let current: any = null;
    const reqId = typeof args.requirementId === 'string' && args.requirementId.trim()
      ? args.requirementId.trim()
      : session?.requirementId;
    const featId = typeof args.featureId === 'string' && args.featureId.trim()
      ? args.featureId.trim()
      : session?.featureId;
    if (reqId) {
      try {
        current = await ext.current(reqId, featId);
      } catch {
        current = null;
      }
    }
    const candidateStage = typeof args.stage === 'string' && args.stage.trim()
      ? args.stage.trim()
      : (session?.stage ?? current?.stage ?? 'SD');
    const stage: WorkflowAgentStage = isWorkflowAgentStage(candidateStage) ? candidateStage : 'SD';

    const assignedRows = await core.store.all(
      `SELECT a.id, a.name, a.cli_command_id AS cliCommandId, a.skill_id AS skillId, a.prompt,
              c.name AS cliName, c.executable, c.args_json AS argsJson,
              s.name AS skillName, s.instructions AS skillInstructions
       FROM workflow_agent_assignments w
       JOIN llm_agents a ON a.id = w.agent_id
       JOIN llm_cli_commands c ON c.id = a.cli_command_id
       LEFT JOIN llm_skills s ON s.id = a.skill_id
       WHERE w.stage = ?
       ORDER BY w.position`,
      [stage],
    );
    const assignedAgents = assignedRows.map((row: any) => ({
      id: String(row.id),
      name: String(row.name),
      cliCommandId: String(row.cliCommandId),
      skillId: row.skillId === null ? null : String(row.skillId),
      prompt: String(row.prompt),
      cliCommand: {
        id: String(row.cliCommandId),
        name: String(row.cliName),
        executable: String(row.executable),
        args: JSON.parse(String(row.argsJson)),
      },
      skill: row.skillId === null
        ? null
        : {
            id: String(row.skillId),
            name: String(row.skillName),
            instructions: String(row.skillInstructions),
          },
    }));

    const sessionMatchesStage = !session?.stage || session.stage === stage;
    const requestedAgentId = typeof args.agentId === 'string' && args.agentId.trim()
      ? args.agentId.trim()
      : (sessionMatchesStage ? session?.agentId : undefined);

    let selectedAgent = requestedAgentId
      ? assignedAgents.find(a => a.id === requestedAgentId)
      : assignedAgents[0];

    if (!selectedAgent && requestedAgentId) {
      const directRows = await core.store.all(
        `SELECT a.id, a.name, a.cli_command_id AS cliCommandId, a.skill_id AS skillId, a.prompt,
                c.name AS cliName, c.executable, c.args_json AS argsJson,
                s.name AS skillName, s.instructions AS skillInstructions
         FROM llm_agents a
         JOIN llm_cli_commands c ON c.id = a.cli_command_id
         LEFT JOIN llm_skills s ON s.id = a.skill_id
         WHERE a.id = ?`,
        [requestedAgentId],
      );
      if (directRows.length > 0) {
        const row = directRows[0];
        selectedAgent = {
          id: String(row.id),
          name: String(row.name),
          cliCommandId: String(row.cliCommandId),
          skillId: row.skillId === null ? null : String(row.skillId),
          prompt: String(row.prompt),
          cliCommand: {
            id: String(row.cliCommandId),
            name: String(row.cliName),
            executable: String(row.executable),
            args: JSON.parse(String(row.argsJson)),
          },
          skill: row.skillId === null
            ? null
            : {
                id: String(row.skillId),
                name: String(row.skillName),
                instructions: String(row.skillInstructions),
              },
        };
      }
    }

    if (!selectedAgent && sessionMatchesStage && session?.agent) {
      selectedAgent = session.agent;
    }

    if (!selectedAgent) {
      throw Object.assign(new Error(`尚未為 ${stage} 階段指派有效的 Agent 設定。`), {
        statusCode: 404,
        code: 'WORKFLOW_AGENT_NOT_ASSIGNED',
      });
    }

    const stageTask =
      stage === 'GHERKIN'
        ? 'Treat the supplied requirement and Gherkin as input data. Keep recommendations in your response unless the user explicitly asks you to modify project files.'
        : stage === 'SD'
          ? sdGenerationTask
          : stage === 'TESTS'
            ? 'Complete the pending Playwright-BDD step definitions in the bundle files while preserving all workbenchTestId annotations and source-case mappings. Submit via workbench_submit_test_completion.'
            : 'Implement the confirmed requirement in the current project directory. Treat Gherkin, SD, and completed spec as immutable acceptance inputs; do not edit or weaken them.';

    const composedPrompt = [
      `# Database-configured Agent Prompt (${selectedAgent.name})`,
      selectedAgent.prompt,
      ...(selectedAgent.skill ? [`# Skill: ${selectedAgent.skill.name}`, selectedAgent.skill.instructions] : []),
      `# Stage Instructions (${stage})`,
      stageTask,
    ].join('\n\n');

    return {
      requirementId: current?.id ?? reqId ?? null,
      requirementKey: current?.requirementKey ?? null,
      featureId: current?.featureId ?? featId ?? null,
      featureKey: current?.featureKey ?? null,
      stage,
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      prompt: selectedAgent.prompt,
      skill: selectedAgent.skill,
      cliCommand: selectedAgent.cliCommand,
      stageTask,
      composedPrompt,
      assignedAgents: assignedAgents.map(a => ({
        id: a.id,
        name: a.name,
        prompt: a.prompt,
        skill: a.skill,
      })),
    };
  }

  async function callTool(name: string, rawArgs: Record<string, any> = {}, sessionIdHeader?: string) {
    const session = resolveSession(rawArgs, sessionIdHeader);
    try {
      if (name === 'workbench_get_agent_prompt') {
        const resolved = await resolveAgentPrompt(rawArgs, session);
        return toolSuccess(resolved);
      }

      if (name === 'workbench_get_context') {
        const { current } = await resolveContext(rawArgs, session);
        let agentPrompt: any = null;
        try {
          agentPrompt = await resolveAgentPrompt({ ...rawArgs, requirementId: current.id, featureId: current.featureId }, session);
        } catch {
          agentPrompt = null;
        }
        return toolSuccess({
          requirementId: current.id,
          requirementKey: current.requirementKey,
          featureId: current.featureId,
          featureKey: current.featureKey,
          stage: current.stage,
          agentPrompt,
          confirmations: current.confirmations,
          documents: {
            gherkin: current.documents.gherkin,
            sd: current.documents.sd,
            spec: current.documents.spec,
          },
          projects: current.projects,
          questions: getQuestions(current.id, current.featureId),
        });
      }

      if (name === 'workbench_get_gherkin_structure') {
        const { current } = await resolveContext(rawArgs, session);
        const gherkin = current.documents.gherkin;
        const versionId = typeof rawArgs.versionId === 'string' && rawArgs.versionId.trim()
          ? rawArgs.versionId.trim()
          : gherkin?.versionId;
        if (!gherkin?.id || !versionId) {
          return toolError('GHERKIN_VERSION_REQUIRED', 'Gherkin document has no saved version');
        }
        const [structured, scenarioTests] = await Promise.all([
          core.structure(gherkin.id, versionId),
          core.scenarioTests(current.id, { featureId: current.featureId, gherkinVersionId: versionId }),
        ]);
        return toolSuccess({
          requirementId: current.id,
          requirementKey: current.requirementKey,
          featureId: current.featureId,
          featureKey: current.featureKey,
          structure: structured,
          ...structured,
          scenarioTests,
        });
      }

      if (name === 'workbench_list_project_files') {
        const { current } = await resolveContext(rawArgs, session);
        const project = ext.selectedProject(current, rawArgs.projectId ?? session?.projectId ?? undefined);
        const files = await listWorkspaceFiles(project.workspaceRef, rawArgs.directory ?? '');
        return toolSuccess({
          projectId: project.id,
          projectName: project.name,
          workspaceRef: project.workspaceRef,
          files,
        });
      }

      if (name === 'workbench_read_project_file') {
        const { current } = await resolveContext(rawArgs, session);
        const project = ext.selectedProject(current, rawArgs.projectId ?? session?.projectId ?? undefined);
        const file = await readWorkspaceFile(project.workspaceRef, rawArgs.path);
        return toolSuccess({
          projectId: project.id,
          projectName: project.name,
          ...file,
        });
      }

      if (name === 'workbench_get_db_schema') {
        const { current } = await resolveContext(rawArgs, session);
        const projectId = rawArgs.projectId ?? session?.projectId ?? undefined;
        const rows = await core.store.all(
          'SELECT c.id, c.project_id, c.sqlite_file_ref, c.environment_label, c.app_base_url FROM target_connections c JOIN requirement_projects rp ON rp.project_id = c.project_id WHERE rp.requirement_id = ?' +
            (projectId ? ' AND c.project_id = ?' : '') +
            (rawArgs.connectionId ? ' AND c.id = ?' : '') +
            ' ORDER BY c.rowid',
          [
            current.id,
            ...(projectId ? [projectId] : []),
            ...(rawArgs.connectionId ? [rawArgs.connectionId] : []),
          ],
        );
        const metaReal = await realpath(metadataFile);
        const connections = [];
        for (const row of rows) {
          const fileReal = await realpath(String(row.sqlite_file_ref));
          if (fileReal === metaReal) {
            return toolError('INVALID_TARGET_DB', 'Target DB must be separate from metadata');
          }
          const rawSchema = await runtime.targetDb.schema(fileReal);
          const tables = Array.isArray(rawSchema) ? rawSchema : (rawSchema as any)?.tables ?? [];
          connections.push({
            id: String(row.id),
            projectId: String(row.project_id),
            environmentLabel: String(row.environment_label),
            appBaseUrl: row.app_base_url ? String(row.app_base_url) : null,
            tables,
            schema: { tables },
          });
        }
        return toolSuccess({
          requirementId: current.id,
          featureId: current.featureId,
          connections,
        });
      }

      if (name === 'workbench_submit_sd') {
        const { current } = await resolveContext(rawArgs, session);
        if (current.stage !== 'SD') {
          return toolError('ARTIFACT_LOCKED_IN_STAGE', '此階段不可修改該產物', { stage: current.stage });
        }
        const confirmedGherkin = current.confirmations.gherkin;
        if (!confirmedGherkin || confirmedGherkin.versionId !== current.documents.gherkin?.versionId) {
          return toolError('WORKFLOW_GATE_NOT_MET', 'Confirm the current gherkin version/hash first');
        }
        const status = rawArgs.status;
        const questions = Array.isArray(rawArgs.questions) ? rawArgs.questions : [];
        if (status === 'needs_input') {
          if (!questions.length || questions.some((q: unknown) => typeof q !== 'string' || !q.trim())) {
            return toolError('LLM_RESPONSE_INVALID', 'needs_input 必須列出待補問題');
          }
          setQuestions(current.id, current.featureId, questions);
          if (rawArgs.publishProposal !== false) {
            await publishProposalFiles(session, { status: 'needs_input', questions });
          }
          const after = await ext.current(current.id, current.featureId);
          return toolSuccess({
            status: 'needs_input',
            requirementId: after.id,
            featureId: after.featureId,
            stage: after.stage,
            sdConfirmed: Boolean(after.confirmations.sd),
            versionId: after.documents.sd?.versionId ?? null,
            questions,
          });
        }
        if (status !== 'completed') {
          return toolError('LLM_RESPONSE_INVALID', 'status must be completed or needs_input');
        }
        const rawText = typeof rawArgs.rawText === 'string' ? rawArgs.rawText : '';
        if (!rawText.trim() || questions.length > 0) {
          return toolError('LLM_RESPONSE_INVALID', '完整提案必須有 rawText 且沒有未解決問題');
        }
        const diagnostics = validateSdFormat(rawText, 'proposal.sd.md');
        if (diagnostics.length > 0) {
          return toolError(
            'SD_FORMAT_INVALID',
            'SD 提案未符合統一格式，未保存為有效版本',
            {
              diagnostics,
              preservedVersionId: current.documents.sd?.versionId ?? null,
              preservedSha256: current.documents.sd?.rawSha256 ?? null,
            },
          );
        }
        setQuestions(current.id, current.featureId, []);
        const savedVersion = await core.saveVersion(current.documents.sd.id, {
          rawText,
          expectedCurrentVersionId: current.documents.sd.versionId ?? null,
          expectedConfirmedGherkinVersionId: confirmedGherkin.versionId,
          sourceGherkinVersionId: confirmedGherkin.versionId,
        });
        emit({
          type: 'document.saved',
          projectId: current.projectId,
          requirementId: current.id,
          featureId: current.featureId,
          documentVersionId: savedVersion.versionId,
          payload: {},
        });
        await publishProposalFiles(session, {
          status: 'completed',
          rawText,
          questions: [],
        });
        const updated = await ext.current(current.id, current.featureId);
        return toolSuccess({
          status: 'completed',
          requirementId: updated.id,
          featureId: updated.featureId,
          stage: updated.stage,
          sdConfirmed: Boolean(updated.confirmations.sd),
          versionId: updated.documents.sd.versionId,
          versionNo: updated.documents.sd.versionNo,
          rawSha256: updated.documents.sd.rawSha256,
          questions: [],
        });
      }

      if (name === 'workbench_submit_test_completion') {
        const { current } = await resolveContext(rawArgs, session);
        if (current.stage !== 'TESTS') {
          return toolError('ARTIFACT_LOCKED_IN_STAGE', '此階段不可修改該產物', { stage: current.stage });
        }
        const confirmedGherkin = current.confirmations.gherkin;
        const confirmedSd = current.confirmations.sd;
        const spec = current.documents.spec;
        if (!confirmedGherkin || !confirmedSd || !spec?.versionId) {
          return toolError('WORKFLOW_GATE_NOT_MET', 'Confirm Gherkin, SD, and generate skeleton first');
        }
        const skeletonVersionId = spec.testStage === 'SKELETON' ? spec.versionId : spec.sourceSkeletonVersionId;
        if (!skeletonVersionId) {
          return toolError('SKELETON_REQUIRED', 'Generate a skeleton before completion');
        }
        const skeleton = await core.getVersion(spec.id, skeletonVersionId);
        const skeletonManifest = skeleton.manifest ?? {};
        if (
          skeleton.testStage !== 'SKELETON' ||
          skeleton.sourceGherkinVersionId !== confirmedGherkin.versionId ||
          (skeletonManifest.sourceGherkinVersionId !== undefined && skeletonManifest.sourceGherkinVersionId !== confirmedGherkin.versionId) ||
          (skeletonManifest.gherkinSha256 !== undefined && skeletonManifest.gherkinSha256 !== confirmedGherkin.rawSha256)
        ) {
          return toolError('SOURCE_VERSION_MISMATCH', 'Skeleton does not reference the currently confirmed Gherkin version/hash');
        }
        if (
          skeletonManifest.sdSha256 !== confirmedSd.rawSha256 ||
          (skeletonManifest.sdVersionId ? skeletonManifest.sdVersionId !== confirmedSd.versionId : Number(current.documents.sd?.versionNo) > 1)
        ) {
          return toolError('REGENERATE_SKELETON_REQUIRED', 'Regenerate the skeleton for the currently confirmed SD version/hash');
        }
        if (
          Number(skeletonManifest.schemaVersion ?? 0) >= 2 &&
          (skeletonManifest.sourceGherkinVersionId !== confirmedGherkin.versionId ||
            skeletonManifest.gherkinSha256 !== confirmedGherkin.rawSha256 ||
            skeletonManifest.sdVersionId !== confirmedSd.versionId)
        ) {
          return toolError('SOURCE_VERSION_MISMATCH', 'Skeleton provenance does not match the confirmed document versions/hashes');
        }
        const status = rawArgs.status;
        const questions = Array.isArray(rawArgs.questions) ? rawArgs.questions : [];
        if (status === 'needs_input') {
          if (!questions.length || questions.some((q: unknown) => typeof q !== 'string' || !q.trim())) {
            return toolError('LLM_RESPONSE_INVALID', 'needs_input 必須列出待補問題');
          }
          setQuestions(current.id, current.featureId, questions);
          emit({
            type: 'test.needsInput',
            projectId: current.projectId,
            requirementId: current.id,
            featureId: current.featureId,
            payload: { questions },
          });
          if (rawArgs.publishProposal !== false) {
            await publishProposalFiles(session, { status: 'needs_input', questions });
          }
          return toolSuccess({
            status: 'needs_input',
            requirementId: current.id,
            featureId: current.featureId,
            stage: current.stage,
            versionId: spec.versionId,
            testStage: spec.testStage,
            questions,
          });
        }
        if (status !== 'completed') {
          return toolError('LLM_RESPONSE_INVALID', 'status must be completed or needs_input');
        }
        const rawText = typeof rawArgs.rawText === 'string' ? rawArgs.rawText : '';
        if (!rawText.trim() || questions.length > 0) {
          return toolError('LLM_RESPONSE_INVALID', '完整提案必須有 rawText 且沒有未解決問題', {
            preservedVersionId: spec.versionId,
            preservedSha256: spec.rawSha256,
          });
        }
        let parsedSpecSource: ReturnType<typeof syntax>;
        try {
          parsedSpecSource = syntax(rawText, 'completion.spec.ts');
        } catch (err: any) {
          return toolError(
            err.code ?? 'SYNTAX_INVALID',
            err.message ?? 'TypeScript 語法錯誤',
            {
              diagnostics: err.diagnostics ?? [{ file: 'completion.spec.ts', line: 1, column: 1, reason: String(err.message) }],
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            },
          );
        }
        const requiredIds = declaredIds(syntax(skeleton.rawText, 'skeleton.spec.ts'));
        const proposedIds = declaredIds(parsedSpecSource);
        if (requiredIds.some(id => !proposedIds.includes(id)) || new Set(proposedIds).size !== proposedIds.length) {
          const missingIds = requiredIds.filter(id => !proposedIds.includes(id));
          return toolError(
            'LLM_ACCEPTANCE_CHANGED',
            'LLM 提案刪除或重複既有 test ID；未接受該提案',
            {
              diagnostics: [{
                file: skeleton.manifest?.specPath ?? 'completion.spec.ts',
                line: 1,
                column: 1,
                reason: missingIds.length
                  ? `Missing required workbenchTestId: ${missingIds.join(', ')}`
                  : 'Duplicate workbenchTestId declarations',
              }],
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            },
          );
        }

        const bundleDirectory = skeleton.manifest?.bundleDirectory;
        const members = new Map<string, string>(
          (skeleton.manifest?.bundleFiles ?? []).map((f: any) => [String(f.path), String(f.rawText)]),
        );
        for (const file of rawArgs.files ?? []) {
          if (
            !file ||
            typeof file.path !== 'string' ||
            typeof file.rawText !== 'string' ||
            file.path.startsWith('/') ||
            file.path.includes('\\') ||
            file.path.split('/').some((part: string) => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules') ||
            Buffer.byteLength(file.rawText) > 2 * 1024 * 1024
          ) {
            return toolError('BUNDLE_INVALID', 'Completion files require safe relative path within bundle and rawText <= 2 MiB', {
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            });
          }
          if (bundleDirectory && !file.path.startsWith(bundleDirectory + '/')) {
            return toolError('BUNDLE_SCOPE_INVALID', 'Completion files must remain in the selected feature directory', {
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            });
          }
          if ((file.path.endsWith('.feature') || file.path.endsWith('.sd.md')) && members.has(file.path) && members.get(file.path) !== file.rawText) {
            return toolError(
              file.path.endsWith('.feature') ? 'APPROVED_GHERKIN_CHANGED' : 'APPROVED_SD_CHANGED',
              'LLM completion cannot modify approved source documents',
              {
                preservedVersionId: spec.versionId,
                preservedSha256: spec.rawSha256,
              },
            );
          }
          members.set(file.path, file.rawText);
        }
        const specPath = skeleton.manifest?.specPath ?? 'generated.spec.ts';
        members.set(specPath, rawText);
        const files = [...members].map(([filePath, fileText]) => ({ path: filePath, rawText: fileText }));

        const available = await core.store.all(
          'SELECT c.id sourceCaseId,c.case_key caseId,c.scenario_id scenarioEntityId,s.scenario_key scenarioId,sv.source_line scenarioLine FROM source_cases c JOIN scenarios s ON s.id=c.scenario_id JOIN scenario_versions sv ON sv.gherkin_version_id=c.gherkin_version_id AND sv.scenario_id=c.scenario_id WHERE c.gherkin_version_id=? AND s.requirement_id=? ORDER BY sv.ordinal,c.row_ordinal',
          [confirmedGherkin.versionId, current.id],
        );
        const resolveMapping = (m: any) => {
          const row = available.find((c: any) =>
            m.sourceCaseId
              ? m.sourceCaseId === c.sourceCaseId
              : (m.scenarioId === c.scenarioId || m.scenarioId === c.scenarioEntityId) && m.caseId === c.caseId,
          );
          if (
            !row ||
            (m.scenarioId !== undefined && ![row.scenarioId, row.scenarioEntityId].includes(m.scenarioId)) ||
            (m.caseId !== undefined && m.caseId !== row.caseId)
          ) {
            return undefined;
          }
          return row;
        };

        const mappings = (skeleton.manifest?.mappings ?? []).map((m: any) => ({ ...m }));
        for (const proposed of rawArgs.mappings ?? []) {
          const matchedSource = resolveMapping(proposed);
          if (!matchedSource) {
            return toolError(
              'MAPPING_INVALID',
              `Mapping ${proposed.testKey ?? ''} references a nonexistent or inconsistent source case`,
              {
                diagnostics: [{ file: specPath, line: 1, column: 1, reason: `Invalid mapping for ${proposed.testKey ?? ''}` }],
                preservedVersionId: spec.versionId,
                preservedSha256: spec.rawSha256,
              },
            );
          }
          const original = mappings.filter((m: any) => m.testKey === proposed.testKey);
          if (original.length) {
            if (!original.some((m: any) => resolveMapping(m)?.sourceCaseId === matchedSource.sourceCaseId)) {
              return toolError(
                'LLM_ACCEPTANCE_CHANGED',
                'LLM completion cannot change an existing test/source mapping',
                {
                  diagnostics: [{ file: specPath, line: 1, column: 1, reason: `Cannot remap existing testKey ${proposed.testKey}` }],
                  preservedVersionId: spec.versionId,
                  preservedSha256: spec.rawSha256,
                },
              );
            }
          } else {
            mappings.push({ ...proposed });
          }
        }

        let declarations: ReturnType<typeof parseTypeScript>['tests'];
        try {
          const parsedTs = parseTypeScript(rawText, specPath, true);
          if (parsedTs.pending) {
            return toolError(
              'TESTS_PENDING_COMPLETION',
              'Unimplemented steps cannot form a completed test snapshot',
              {
                diagnostics: [{ file: specPath, line: 1, column: 1, reason: 'Spec still contains unimplemented or empty test body' }],
                preservedVersionId: spec.versionId,
                preservedSha256: spec.rawSha256,
              },
            );
          }
          declarations = parsedTs.tests;
        } catch (err: any) {
          return toolError(
            err.code ?? 'SYNTAX_INVALID',
            err.message ?? 'TypeScript 解析失敗',
            {
              diagnostics: err.diagnostics ?? [{ file: specPath, line: 1, column: 1, reason: String(err.message) }],
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            },
          );
        }

        const cases = mappings.map((mapping: any) => {
          const row = resolveMapping(mapping)!;
          const prior = (skeleton.manifest?.cases ?? []).find(
            (c: any) =>
              c.testKey === mapping.testKey &&
              (c.sourceCaseId === row.sourceCaseId || (c.scenarioId === row.scenarioId && c.caseId === row.caseId)),
          );
          const sourceSteps = prior?.steps?.map((step: any) => {
            const { generatedLine, ...rest } = step;
            return { ...rest, ...(generatedLine ? { sourceSkeletonGeneratedLine: generatedLine } : {}) };
          });
          return {
            ...prior,
            ...row,
            testKey: mapping.testKey,
            generatedLine: declarations.find(t => t.testKey === mapping.testKey)?.line,
            ...(sourceSteps ? { steps: sourceSteps } : {}),
          };
        });

        const baseManifest: any = {
          ...skeleton.manifest,
          schemaVersion: 2,
          sourceGherkinVersionId: confirmedGherkin.versionId,
          gherkinSha256: confirmedGherkin.rawSha256,
          sdVersionId: confirmedSd.versionId,
          sdSha256: confirmedSd.rawSha256,
          sourceSkeletonVersionId: skeleton.versionId,
          sourceSkeletonSha256: skeleton.rawSha256,
          sourceSkeletonManifestSha256: skeleton.manifestSha256,
          mappings,
          cases,
          specPath,
          stage: 'COMPLETION_DRAFT',
          artifactStage: 'COMPLETION_DRAFT',
          completionStatus: 'PENDING',
          productE2E: 'NOT_RUN',
          specSha256: sha256(rawText),
          bundleFiles: files,
          fileHashes: Object.fromEntries(files.map(f => [f.path, sha256(f.rawText)])),
          pendingSlots: [],
        };
        delete baseManifest.manifestSha256;
        baseManifest.manifestSha256 = sha256(JSON.stringify(baseManifest));

        let checks: any;
        try {
          checks = await generation.generator.validateCompletion({
            rawText,
            files,
            manifest: baseManifest,
          });
          if (!checks.passed) {
            return toolError(
              'COMPLETION_CHECKS_FAILED',
              'Completed test bundle did not pass typecheck/discovery',
              {
                diagnostics: checks.diagnostics ?? [{ file: specPath, line: 1, column: 1, reason: 'Completion checks did not pass' }],
                preservedVersionId: spec.versionId,
                preservedSha256: spec.rawSha256,
              },
            );
          }
        } catch (err: any) {
          return toolError(
            err.code ?? 'COMPLETION_CHECKS_FAILED',
            err.message ?? 'Completed test bundle did not pass validation',
            {
              diagnostics: err.diagnostics ?? [{ file: specPath, line: 1, column: 1, reason: String(err.message) }],
              preservedVersionId: spec.versionId,
              preservedSha256: spec.rawSha256,
            },
          );
        }

        setQuestions(current.id, current.featureId, []);
        const completedManifest: any = {
          ...baseManifest,
          stage: 'COMPLETED',
          artifactStage: 'COMPLETED',
          completionStatus: 'COMPLETED',
          checks,
          pendingSlots: [],
        };
        delete completedManifest.manifestSha256;
        completedManifest.manifestSha256 = sha256(JSON.stringify(completedManifest));
        const saved = await core.saveVersion(spec.id, {
          rawText,
          expectedCurrentVersionId: spec.versionId,
          expectedConfirmedGherkinVersionId: confirmedGherkin.versionId,
          expectedConfirmedSdVersionId: confirmedSd.versionId,
          sourceGherkinVersionId: confirmedGherkin.versionId,
          sourceSkeletonVersionId: skeleton.versionId,
          testStage: 'COMPLETED',
          manifest: completedManifest,
        });
        emit({
          type: 'test.completionSaved',
          projectId: current.projectId,
          requirementId: current.id,
          featureId: current.featureId,
          documentVersionId: saved.versionId,
          payload: { testStage: 'COMPLETED' },
        });
        await publishProposalFiles(session, {
          status: 'completed',
          rawText,
          questions: [],
          ...(rawArgs.files ? { files: rawArgs.files } : {}),
          ...(rawArgs.mappings ? { mappings: rawArgs.mappings } : {}),
        });
        const updated = await ext.current(current.id, current.featureId);
        return toolSuccess({
          status: 'completed',
          requirementId: updated.id,
          featureId: updated.featureId,
          stage: updated.stage,
          testStage: updated.documents.spec.testStage,
          versionId: updated.documents.spec.versionId,
          versionNo: updated.documents.spec.versionNo,
          rawSha256: updated.documents.spec.rawSha256,
          checks,
          questions: [],
        });
      }

      return toolError('TOOL_NOT_FOUND', `Unknown MCP tool: ${name}`);
    } catch (error: any) {
      return toolError(
        error.code ?? 'MCP_TOOL_ERROR',
        error.message ?? 'MCP tool execution failed',
        error.diagnostics ? { diagnostics: error.diagnostics } : {},
      );
    }
  }

  async function handleJsonRpc(payload: any, sessionIdHeader?: string): Promise<any> {
    if (Array.isArray(payload)) {
      return Promise.all(payload.map(item => handleJsonRpc(item, sessionIdHeader)));
    }
    if (!payload || typeof payload !== 'object' || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: payload?.id ?? null,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }
    const id = payload.id ?? null;
    const { method, params } = payload;
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'bdd-workbench-mcp', version: '0.1.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method === 'initialized' || method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { prompts: promptDefinitions },
      };
    }
    if (method === 'prompts/get') {
      const promptName = params?.name;
      if (promptName !== 'workbench_stage_prompt') {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown prompt: ${String(promptName ?? '')}` },
        };
      }
      const args = params?.arguments ?? {};
      const session = resolveSession(args, sessionIdHeader);
      try {
        const resolved = await resolveAgentPrompt(args, session);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: `${resolved.stage} Agent Prompt (${resolved.agentName})`,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: resolved.composedPrompt,
                },
              },
            ],
            agent: {
              id: resolved.agentId,
              name: resolved.agentName,
              stage: resolved.stage,
              prompt: resolved.prompt,
              skill: resolved.skill,
            },
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: String(err.message ?? 'Failed to resolve stage prompt') },
        };
      }
    }
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: toolDefinitions },
      };
    }
    if (method === 'tools/call') {
      const toolName = params?.name;
      if (typeof toolName !== 'string' || !toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name' },
        };
      }
      const result = await callTool(toolName, params?.arguments ?? {}, sessionIdHeader);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  return {
    promptDefinitions,
    toolDefinitions,
    createSession,
    closeSession,
    getQuestions,
    setQuestions,
    callTool,
    handleJsonRpc,
  };
}
export type McpServer = ReturnType<typeof createMcpServer>;
