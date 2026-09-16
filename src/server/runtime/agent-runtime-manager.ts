import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { createAgent, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import type { InferSelectModel } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, messages, models, runs, sessions } from '../db/schema.js';
import { createChatModel } from './model-factory.js';

type AgentRecord = InferSelectModel<typeof agents>;
type ModelRecord = InferSelectModel<typeof models>;
type Runtime = ReturnType<typeof createAgent>;

type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type StreamEvent =
  | { version: 1; type: 'session'; sessionId: string; runId: string; correlationId: string }
  | { version: 1; type: 'token'; text: string }
  | { version: 1; type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { version: 1; type: 'done'; sessionId: string; runId: string }
  | { version: 1; type: 'cancelled'; sessionId: string; runId: string }
  | { version: 1; type: 'error'; message: string };

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

export class AgentRuntimeManager {
  private readonly cache = new Map<string, { key: string; runtime: Runtime }>();

  invalidateAgent(agentId: string): void {
    this.cache.delete(agentId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private getRuntime(agentRow: AgentRecord, modelRow: ModelRecord): Runtime {
    const key = `${agentRow.updatedAt}:${modelRow.updatedAt}`;
    const cached = this.cache.get(agentRow.id);
    if (cached?.key === key) return cached.runtime;

    const model = createChatModel(modelRow, {
      temperature: agentRow.temperature,
      maxTokens: agentRow.maxTokens,
    });
    const runtime = createAgent({
      model,
      tools: [],
      systemPrompt: agentRow.instructions,
      middleware: [
        modelCallLimitMiddleware({ runLimit: agentRow.maxModelCalls, exitBehavior: 'error' }),
        toolCallLimitMiddleware({ runLimit: agentRow.maxToolCalls, exitBehavior: 'error' }),
      ],
    });
    this.cache.set(agentRow.id, { key, runtime });
    return runtime;
  }

  async *stream(
    agentId: string,
    requestedSessionId: string | undefined,
    userText: string,
    options: { signal?: AbortSignal; correlationId?: string } = {},
  ): AsyncGenerator<StreamEvent> {
    const agentRows = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.enabled, true))).limit(1);
    const agentRow = agentRows[0];
    if (!agentRow) throw new Error('Agent not found or disabled');

    const modelRows = await db.select().from(models).where(and(eq(models.id, agentRow.modelRef), eq(models.enabled, true))).limit(1);
    const modelRow = modelRows[0];
    if (!modelRow) throw new Error('Configured model not found or disabled');

    const now = new Date().toISOString();
    let sessionId = requestedSessionId;

    if (sessionId) {
      const found = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId))).limit(1);
      if (!found[0]) throw new Error('Session not found for this agent');
    } else {
      sessionId = randomUUID();
      await db.insert(sessions).values({ id: sessionId, agentId, title: userText.slice(0, 80), createdAt: now, updatedAt: now });
    }

    await db.insert(messages).values({ id: randomUUID(), sessionId, role: 'user', content: userText, createdAt: now });
    await db.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId));

    const runId = randomUUID();
    const correlationId = options.correlationId ?? randomUUID();
    await db.insert(runs).values({ id: runId, sessionId, agentId, status: 'running', startedAt: now, correlationId });
    yield { version: 1, type: 'session', sessionId, runId, correlationId };

    try {
      const history = await db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt));
      const runtime = this.getRuntime(agentRow, modelRow);
      const eventStream = await runtime.streamEvents(
        { messages: history.map((message) => ({ role: message.role, content: message.content })) },
        { version: 'v3', signal: options.signal, timeout: modelRow.timeoutMs },
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
        await db.update(runs).set({ status: 'cancelled', completedAt: new Date().toISOString() }).where(eq(runs.id, runId));
        yield { version: 1, type: 'cancelled', sessionId, runId };
        return;
      }

      const completedAt = new Date().toISOString();
      await db.insert(messages).values({ id: randomUUID(), sessionId, role: 'assistant', content: assistantText, createdAt: completedAt });
      await db.update(sessions).set({ updatedAt: completedAt }).where(eq(sessions.id, sessionId));
      await db.update(runs).set({
        status: 'completed', completedAt,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      }).where(eq(runs.id, runId));
      if (usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.totalTokens !== undefined) {
        yield { version: 1, type: 'usage', ...usage };
      }
      yield { version: 1, type: 'done', sessionId, runId };
    } catch (error) {
      const aborted = options.signal?.aborted;
      const message = error instanceof Error ? error.message : 'Unknown agent runtime error';
      await db.update(runs).set({ status: aborted ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), error: aborted ? null : message }).where(eq(runs.id, runId));
      if (aborted) yield { version: 1, type: 'cancelled', sessionId, runId };
      else yield { version: 1, type: 'error', message };
    }
  }
}
