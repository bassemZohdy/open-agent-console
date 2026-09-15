import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { createAgent } from 'langchain';
import { db } from '../db/index.js';
import { agents, messages, models, runs, sessions } from '../db/schema.js';
import { createChatModel } from './model-factory.js';

export type StreamEvent =
  | { type: 'session'; sessionId: string; runId: string }
  | { type: 'token'; text: string }
  | { type: 'done'; sessionId: string; runId: string }
  | { type: 'error'; message: string };

export class AgentRuntimeManager {
  async *stream(agentId: string, requestedSessionId: string | undefined, userText: string): AsyncGenerator<StreamEvent> {
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
      await db.insert(sessions).values({
        id: sessionId,
        agentId,
        title: userText.slice(0, 80),
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(messages).values({
      id: randomUUID(),
      sessionId,
      role: 'user',
      content: userText,
      createdAt: now,
    });
    await db.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId));

    const runId = randomUUID();
    await db.insert(runs).values({
      id: runId,
      sessionId,
      agentId,
      status: 'running',
      startedAt: now,
    });

    yield { type: 'session', sessionId, runId };

    try {
      const history = await db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt));
      const model = createChatModel(modelRow, {
        temperature: agentRow.temperature,
        maxTokens: agentRow.maxTokens,
      });
      const runtime = createAgent({ model, tools: [], systemPrompt: agentRow.instructions });

      const eventStream = await runtime.streamEvents(
        { messages: history.map((message) => ({ role: message.role, content: message.content })) },
        { version: 'v3' },
      );

      let assistantText = '';
      for await (const streamedMessage of eventStream.messages) {
        for await (const delta of streamedMessage.text) {
          if (!delta) continue;
          assistantText += delta;
          yield { type: 'token', text: delta };
        }
      }
      await eventStream.output;

      const completedAt = new Date().toISOString();
      await db.insert(messages).values({
        id: randomUUID(),
        sessionId,
        role: 'assistant',
        content: assistantText,
        createdAt: completedAt,
      });
      await db.update(sessions).set({ updatedAt: completedAt }).where(eq(sessions.id, sessionId));
      await db.update(runs).set({ status: 'completed', completedAt }).where(eq(runs.id, runId));
      yield { type: 'done', sessionId, runId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent runtime error';
      await db.update(runs).set({ status: 'failed', completedAt: new Date().toISOString(), error: message }).where(eq(runs.id, runId));
      yield { type: 'error', message };
    }
  }
}
