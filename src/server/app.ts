import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { sqlite } from './db/index.js';
import { RegistryRepository } from './db/repository.js';
import {
  chatRequestSchema, createAgentSchema, createModelSchema, paginationSchema, updateAgentSchema, updateModelSchema,
} from './domain/schemas.js';
import { AgentRuntimeManager } from './runtime/agent-runtime-manager.js';
import { testModelConnection } from './runtime/model-factory.js';

function capabilities(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  const runtime = new AgentRuntimeManager();
  const repository = new RegistryRepository();

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Validation failed', details: error.issues });
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return reply.code(503).send({ error: 'Database is temporarily busy; retry the request' });
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return reply.code(409).send({ error: 'Operation conflicts with referenced records' });
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async (_request, reply) => {
    try {
      sqlite.prepare('SELECT 1').get();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not-ready' });
    }
  });

  app.get('/api/models', async () => {
    const rows = await repository.listModels();
    return rows.map((row) => ({ ...row, capabilities: capabilities(row.capabilitiesJson), capabilitiesJson: undefined }));
  });

  app.post('/api/models', async (request, reply) => {
    const input = createModelSchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(), name: input.name, provider: input.provider, modelId: input.modelId,
      baseUrl: input.baseUrl || null, apiKeyEnv: input.apiKeyEnv, enabled: true,
      temperature: input.temperature ?? null, maxTokens: input.maxTokens ?? null,
      capabilitiesJson: JSON.stringify(input.capabilities), timeoutMs: input.timeoutMs, maxRetries: input.maxRetries,
      createdAt: now, updatedAt: now,
    };
    await repository.insertModel(row);
    runtime.invalidateAll();
    return reply.code(201).send({ ...row, capabilities: input.capabilities, capabilitiesJson: undefined });
  });

  app.put('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getModel(id);
    if (!current) return reply.code(404).send({ error: 'Model not found' });
    const patch = updateModelSchema.parse(request.body);
    const merged = createModelSchema.parse({
      name: patch.name ?? current.name,
      provider: patch.provider ?? current.provider,
      modelId: patch.modelId ?? current.modelId,
      baseUrl: patch.baseUrl ?? current.baseUrl ?? '',
      apiKeyEnv: patch.apiKeyEnv ?? current.apiKeyEnv,
      temperature: patch.temperature ?? current.temperature ?? undefined,
      maxTokens: patch.maxTokens ?? current.maxTokens ?? undefined,
      capabilities: patch.capabilities ?? capabilities(current.capabilitiesJson),
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      maxRetries: patch.maxRetries ?? current.maxRetries,
    });
    await repository.updateModel(id, {
      name: merged.name, provider: merged.provider, modelId: merged.modelId, baseUrl: merged.baseUrl || null,
      apiKeyEnv: merged.apiKeyEnv, temperature: merged.temperature ?? null, maxTokens: merged.maxTokens ?? null,
      capabilitiesJson: JSON.stringify(merged.capabilities), timeoutMs: merged.timeoutMs, maxRetries: merged.maxRetries,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return reply.send({ ok: true });
  });

  app.delete('/api/models/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const referenced = (await repository.listAgents()).some((agent) => agent.modelRef === id);
    if (referenced) return reply.code(409).send({ error: 'Model is referenced by one or more agents' });
    await repository.deleteModel(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });

  app.post('/api/models/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.code(404).send({ error: 'Model not found' });
    const result = await testModelConnection(model);
    return { ok: true, ...result };
  });

  app.get('/api/agents', async () => repository.listAgents());
  app.post('/api/agents', async (request, reply) => {
    const input = createAgentSchema.parse(request.body);
    if (!await repository.getModel(input.modelRef)) return reply.code(400).send({ error: 'Model does not exist' });
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(), name: input.name, description: input.description ?? null, modelRef: input.modelRef,
      instructions: input.instructions, enabled: true, temperature: input.temperature ?? null, maxTokens: input.maxTokens ?? null,
      maxModelCalls: input.maxModelCalls, maxToolCalls: input.maxToolCalls, createdAt: now, updatedAt: now,
    };
    await repository.insertAgent(row);
    return reply.code(201).send(row);
  });

  app.put('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getAgent(id);
    if (!current) return reply.code(404).send({ error: 'Agent not found' });
    const patch = updateAgentSchema.parse(request.body);
    const merged = createAgentSchema.parse({
      name: patch.name ?? current.name, description: patch.description ?? current.description ?? undefined,
      modelRef: patch.modelRef ?? current.modelRef, instructions: patch.instructions ?? current.instructions,
      temperature: patch.temperature ?? current.temperature ?? undefined, maxTokens: patch.maxTokens ?? current.maxTokens ?? undefined,
      maxModelCalls: patch.maxModelCalls ?? current.maxModelCalls, maxToolCalls: patch.maxToolCalls ?? current.maxToolCalls,
    });
    if (!await repository.getModel(merged.modelRef)) return reply.code(400).send({ error: 'Model does not exist' });
    await repository.updateAgent(id, {
      name: merged.name, description: merged.description ?? null, modelRef: merged.modelRef, instructions: merged.instructions,
      temperature: merged.temperature ?? null, maxTokens: merged.maxTokens ?? null,
      maxModelCalls: merged.maxModelCalls, maxToolCalls: merged.maxToolCalls, updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAgent(id);
    return { ok: true };
  });

  app.patch('/api/agents/:id/enabled', async (request, reply) => {
    const { id } = request.params as { id: string };
    const enabled = (request.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== 'boolean') return reply.code(400).send({ error: 'enabled must be boolean' });
    if (!await repository.getAgent(id)) return reply.code(404).send({ error: 'Agent not found' });
    await repository.updateAgent(id, { enabled, updatedAt: new Date().toISOString() });
    runtime.invalidateAgent(id);
    return { ok: true };
  });

  app.post('/api/agents/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getAgent(id);
    if (!current) return reply.code(404).send({ error: 'Agent not found' });
    const now = new Date().toISOString();
    const duplicate = { ...current, id: randomUUID(), name: `${current.name} Copy`, enabled: false, createdAt: now, updatedAt: now };
    await repository.insertAgent(duplicate);
    return reply.code(201).send(duplicate);
  });

  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await repository.deleteAgent(id);
    runtime.invalidateAgent(id);
    return reply.code(204).send();
  });

  app.get('/api/sessions', async (request) => {
    const page = paginationSchema.parse(request.query);
    return { items: await repository.listSessions(page.offset, page.limit), ...page };
  });
  app.get('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!await repository.getSession(id)) return reply.code(404).send({ error: 'Session not found' });
    return repository.listMessages(id);
  });
  app.get('/api/runs', async (request) => {
    const page = paginationSchema.parse(request.query);
    return { items: await repository.listRuns(page.offset, page.limit), ...page };
  });

  app.post('/api/agents/:id/chat', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = chatRequestSchema.parse(request.body);
    const controller = new AbortController();
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) controller.abort(); });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Correlation-ID': request.id,
    });
    try {
      for await (const event of runtime.stream(id, input.sessionId, input.message, { signal: controller.signal, correlationId: request.id })) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent execution failed';
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ version: 1, type: 'error', message })}\n\n`);
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
