import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db, ensureSchema } from './db/index.js';
import { agents, messages, models, runs, sessions } from './db/schema.js';
import { chatRequestSchema, createAgentSchema, createModelSchema } from './domain/schemas.js';
import { AgentRuntimeManager } from './runtime/agent-runtime-manager.js';

export function buildApp() {
  ensureSchema();
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  const runtime = new AgentRuntimeManager();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async () => ({ status: 'ready' }));

  app.get('/api/models', async () => db.select().from(models).orderBy(desc(models.createdAt)));
  app.post('/api/models', async (request, reply) => {
    const input = createModelSchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      provider: input.provider,
      modelId: input.modelId,
      baseUrl: input.baseUrl || null,
      apiKeyEnv: input.apiKeyEnv,
      enabled: true,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(models).values(row);
    return reply.code(201).send(row);
  });

  app.get('/api/agents', async () => db.select().from(agents).orderBy(desc(agents.createdAt)));
  app.post('/api/agents', async (request, reply) => {
    const input = createAgentSchema.parse(request.body);
    const model = await db.select().from(models).where(eq(models.id, input.modelRef)).limit(1);
    if (!model[0]) return reply.code(400).send({ error: 'Model does not exist' });
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      modelRef: input.modelRef,
      instructions: input.instructions,
      enabled: true,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(agents).values(row);
    return reply.code(201).send(row);
  });

  app.get('/api/sessions', async () => db.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(100));
  app.get('/api/sessions/:id/messages', async (request) => {
    const { id } = request.params as { id: string };
    return db.select().from(messages).where(eq(messages.sessionId, id));
  });
  app.get('/api/runs', async () => db.select().from(runs).orderBy(desc(runs.startedAt)).limit(100));

  app.post('/api/agents/:id/chat', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = chatRequestSchema.parse(request.body);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of runtime.stream(id, input.sessionId, input.message)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent execution failed';
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  const webRoot = path.resolve(process.cwd(), 'dist/web');
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
