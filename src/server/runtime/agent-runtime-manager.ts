import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { createAgent, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import type { InferSelectModel } from 'drizzle-orm';
import { db } from '../db/index.js';
import { RegistryRepository, type Database } from '../db/repository.js';
import { agents, messages, models, runs, sessions } from '../db/schema.js';
import { resolveMemoryConnector } from './memory-service.js';
import { createChatModel } from './model-factory.js';
import { buildEffectivePrompt } from './prompt-builder.js';
import { resolveTools } from './tool-resolver.js';

type AgentRecord = InferSelectModel<typeof agents>;
type ModelRecord = InferSelectModel<typeof models>;
type Runtime = ReturnType<typeof createAgent>;
type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

type CachedRuntime = { key: string; runtime: Runtime; dispose: () => Promise<void> };

export type StreamEvent =
  | { version: 1; type: 'session'; sessionId: string; runId: string; correlationId: string }
  | { version: 1; type: 'token'; text: string }
  | { version: 1; type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { version: 1; type: 'done'; sessionId: string; runId: string }
  | { version: 1; type: 'cancelled'; sessionId: string; runId: string }
  | { version: 1; type: 'error'; message: string; code?: string; correlationId?: string };

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): Usage {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  const inputTokens = numeric(row.inputTokens) ?? numeric(row.input_tokens) ?? numeric(row.promptTokens) ?? numeric(row.prompt_tokens);
  const outputTokens = numeric(row.outputTokens) ?? numeric(row.output_tokens) ?? numeric(row.completionTokens) ?? numeric(row.completion_tokens);
  const totalTokens = numeric(row.totalTokens) ?? numeric(row.total_tokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  return { inputTokens, outputTokens, totalTokens };
}

function configuredLimit(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

export class AgentRuntimeManager {
  private readonly cache = new Map<string, CachedRuntime>();
  private readonly pending = new Map<string, Promise<Runtime>>();
  private readonly database: Database;
  private readonly repository: RegistryRepository;

  constructor(options: { database?: Database; repository?: RegistryRepository } = {}) {
    this.repository = options.repository ?? new RegistryRepository(options.database ?? db);
    this.database = options.database ?? this.repository.database;
  }

  private disposeEntry(agentId: string): void {
    const entry = this.cache.get(agentId);
    this.cache.delete(agentId);
    if (entry) void entry.dispose();
  }

  invalidateAgent(agentId: string): void { this.disposeEntry(agentId); }

  invalidateAll(): void {
    for (const agentId of this.cache.keys()) this.disposeEntry(agentId);
  }

  private async dependencyKey(agentRow: AgentRecord, modelRow: ModelRecord): Promise<string> {
    const orderedSkills = await this.repository.listAgentSkills(agentRow.id);
    const orderedTools = await this.repository.listAgentTools(agentRow.id);
    const mcpServerIds = orderedTools
      .map(({ tool }) => tool.mcpServerId)
      .filter((id): id is string => Boolean(id));
    const mcpServers = await Promise.all(
      [...new Set(mcpServerIds)].map((id) => this.repository.getMcpServer(id)),
    );
    const memories = agentRow.memoryConnectorId
      ? await this.repository.listMemories(agentRow.id, agentRow.memoryConnectorId)
      : [];
    return JSON.stringify({
      agent: agentRow.updatedAt,
      model: modelRow.updatedAt,
      skills: orderedSkills.map(({ skill, position }) => [skill.id, skill.updatedAt, skill.enabled, position]),
      tools: orderedTools.map(({ tool, position }) => [tool.id, tool.updatedAt, tool.enabled, position]),
      mcpServers: mcpServers.map((server) => server && [server.id, server.updatedAt, server.enabled]),
      memoryConnector: agentRow.memoryConnectorId,
      memories: memories.map((memory) => [memory.id, memory.updatedAt]),
    });
  }

  async effectivePrompt(agentId: string): Promise<string> {
    const agentRow = await this.repository.getAgent(agentId);
    if (!agentRow) throw new Error('Agent not found');
    const orderedSkills = (await this.repository.listAgentSkills(agentId)).map(({ skill }) => skill);
    const memory = await resolveMemoryConnector(this.repository, agentRow);
    return buildEffectivePrompt(agentRow, orderedSkills, await memory.load(agentRow));
  }

  private async getRuntime(agentRow: AgentRecord, modelRow: ModelRecord): Promise<Runtime> {
    const key = await this.dependencyKey(agentRow, modelRow);
    const cached = this.cache.get(agentRow.id);
    if (cached?.key === key) return cached.runtime;
    if (cached) this.disposeEntry(agentRow.id);

    const pending = this.pending.get(agentRow.id);
    if (pending) return pending;

    const build = (async () => {
      const orderedSkills = (await this.repository.listAgentSkills(agentRow.id)).map(({ skill }) => skill);
      const memory = await resolveMemoryConnector(this.repository, agentRow);
      const systemPrompt = buildEffectivePrompt(agentRow, orderedSkills, await memory.load(agentRow));
      const resolvedTools = await resolveTools(this.repository, agentRow.id);
      const model = createChatModel(modelRow, { temperature: agentRow.temperature, maxTokens: agentRow.maxTokens });
      const runtime = createAgent({
        model,
        tools: resolvedTools.tools,
        systemPrompt,
        middleware: [
          modelCallLimitMiddleware({ runLimit: agentRow.maxModelCalls, exitBehavior: 'error' }),
          toolCallLimitMiddleware({ runLimit: agentRow.maxToolCalls, exitBehavior: 'error' }),
        ],
      });
      this.cache.set(agentRow.id, { key, runtime, dispose: resolvedTools.dispose });
      return runtime;
    })();
    this.pending.set(agentRow.id, build);
    try {
      return await build;
    } finally {
      if (this.pending.get(agentRow.id) === build) this.pending.delete(agentRow.id);
    }
  }

  async *stream(
    agentId: string,
    requestedSessionId: string | undefined,
    userText: string,
    options: { signal?: AbortSignal; correlationId?: string } = {},
  ): AsyncGenerator<StreamEvent> {
    const agentRows = await this.database.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.enabled, true))).limit(1);
    const agentRow = agentRows[0];
    if (!agentRow) throw new Error('Agent not found or disabled');
    const modelRows = await this.database.select().from(models).where(and(eq(models.id, agentRow.modelRef), eq(models.enabled, true))).limit(1);
    const modelRow = modelRows[0];
    if (!modelRow) throw new Error('Configured model not found or disabled');

    const now = new Date().toISOString();
    let sessionId = requestedSessionId;
    if (sessionId) {
      const found = await this.database.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId))).limit(1);
      if (!found[0]) throw new Error('Session not found for this agent');
    } else {
      sessionId = randomUUID();
      await this.database.insert(sessions).values({ id: sessionId, agentId, title: userText.slice(0, 80), createdAt: now, updatedAt: now });
    }

    await this.database.insert(messages).values({ id: randomUUID(), sessionId, role: 'user', content: userText, createdAt: now });
    await this.database.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId));
    const runId = randomUUID();
    const correlationId = options.correlationId ?? randomUUID();
    await this.database.insert(runs).values({ id: runId, sessionId, agentId, status: 'running', startedAt: now, correlationId });
    yield { version: 1, type: 'session', sessionId, runId, correlationId };

    try {
      const maxHistoryMessages = configuredLimit('OAC_MAX_HISTORY_MESSAGES', 80, 2, 10_000);
      const maxHistoryChars = configuredLimit('OAC_MAX_HISTORY_CHARS', 120_000, 2_000, 1_000_000);
      const recentHistory = await this.database.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(desc(messages.createdAt)).limit(maxHistoryMessages);
      const history = recentHistory.reverse();
      let historyChars = 0;
      const boundedHistory = [];
      let contextTruncated = recentHistory.length >= maxHistoryMessages;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (!message) continue;
        const nextChars = historyChars + message.content.length;
        if (boundedHistory.length > 0 && nextChars > maxHistoryChars) {
          contextTruncated = true;
          break;
        }
        boundedHistory.unshift(message);
        historyChars = nextChars;
      }
      if (boundedHistory.length === 0 && history.length > 0) {
        const latest = history[history.length - 1];
        if (latest) {
          boundedHistory.push({
            ...latest,
            content: latest.content.slice(0, maxHistoryChars),
          });
          contextTruncated = true;
        }
      }
      await this.database.update(runs).set({ contextTruncated }).where(eq(runs.id, runId));
      const runtime = await this.getRuntime(agentRow, modelRow);
      const eventStream = await runtime.streamEvents(
        { messages: boundedHistory.map((message) => ({ role: message.role, content: message.content })) },
        { version: 'v3', signal: options.signal, timeout: modelRow.timeoutMs, metadata: { oacRunId: runId, oacAgentId: agentId } },
      );

      let assistantText = '';
      let usage: Usage = {};
      for await (const streamedMessage of eventStream.messages) {
        for await (const delta of streamedMessage.text) {
          if (!delta) continue;
          assistantText += delta;
          yield { version: 1, type: 'token', text: delta };
        }
        const messageUsage = normalizeUsage(await streamedMessage.usage);
        usage = {
          inputTokens: (usage.inputTokens ?? 0) + (messageUsage.inputTokens ?? 0),
          outputTokens: (usage.outputTokens ?? 0) + (messageUsage.outputTokens ?? 0),
          totalTokens: (usage.totalTokens ?? 0) + (messageUsage.totalTokens ?? 0),
        };
      }
      await eventStream.output;

      if (options.signal?.aborted) {
        await this.database.update(runs).set({ status: 'cancelled', completedAt: new Date().toISOString() }).where(eq(runs.id, runId));
        yield { version: 1, type: 'cancelled', sessionId, runId };
        return;
      }

      const completedAt = new Date().toISOString();
      await this.database.insert(messages).values({ id: randomUUID(), sessionId, role: 'assistant', content: assistantText, createdAt: completedAt });
      await this.database.update(sessions).set({ updatedAt: completedAt }).where(eq(sessions.id, sessionId));
      await this.database.update(runs).set({ status: 'completed', completedAt, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }).where(eq(runs.id, runId));
      if (usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.totalTokens !== undefined) yield { version: 1, type: 'usage', ...usage };
      yield { version: 1, type: 'done', sessionId, runId };
    } catch (error) {
      const aborted = options.signal?.aborted;
      const message = error instanceof Error ? error.message : 'Unknown agent runtime error';
      await this.database.update(runs).set({ status: aborted ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), error: aborted ? null : message }).where(eq(runs.id, runId));
      if (aborted) yield { version: 1, type: 'cancelled', sessionId, runId };
      else yield { version: 1, type: 'error', message, code: 'AGENT_EXECUTION_FAILED', correlationId };
    }
  }
}
