import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/server/db/index.js';
import { RegistryRepository } from '../src/server/db/repository.js';

const openDatabases: Array<ReturnType<typeof createDatabase>> = [];

function repository() {
  const connection = createDatabase(':memory:');
  openDatabases.push(connection);
  return new RegistryRepository(connection.db);
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.sqlite.close();
});

describe('RegistryRepository', () => {
  it('persists model, agent, session, messages and run records', async () => {
    const repo = repository();
    const now = new Date().toISOString();
    const modelId = randomUUID();
    const agentId = randomUUID();
    const sessionId = randomUUID();
    const runId = randomUUID();

    await repo.insertModel({
      id: modelId,
      name: 'Local model',
      provider: 'ollama',
      modelId: 'qwen3',
      baseUrl: 'http://127.0.0.1:11434',
      apiKeyEnv: '',
      enabled: true,
      temperature: 0,
      maxTokens: 512,
      capabilitiesJson: '["streaming"]',
      timeoutMs: 15_000,
      maxRetries: 1,
      createdAt: now,
      updatedAt: now,
    });

    await repo.insertAgent({
      id: agentId,
      name: 'Test agent',
      modelRef: modelId,
      instructions: 'Be concise.',
      enabled: true,
      maxModelCalls: 4,
      maxToolCalls: 6,
      createdAt: now,
      updatedAt: now,
    });

    await repo.insertSession({ id: sessionId, agentId, title: 'Hello', createdAt: now, updatedAt: now });
    await repo.insertMessage({ id: randomUUID(), sessionId, role: 'user', content: 'Hello', createdAt: now });
    await repo.insertRun({ id: runId, sessionId, agentId, status: 'completed', startedAt: now, completedAt: now, totalTokens: 3 });

    expect((await repo.getModel(modelId))?.name).toBe('Local model');
    expect((await repo.getAgent(agentId))?.name).toBe('Test agent');
    expect((await repo.listSessions(0, 10))[0]?.id).toBe(sessionId);
    expect((await repo.listMessages(sessionId))[0]?.content).toBe('Hello');
    expect((await repo.getRun(runId))?.totalTokens).toBe(3);
  });

  it('updates registry records and applies pagination', async () => {
    const repo = repository();
    const now = new Date().toISOString();
    const modelId = randomUUID();
    const agentId = randomUUID();

    await repo.insertModel({ id: modelId, name: 'Model', provider: 'openai', modelId: 'gpt-test', apiKeyEnv: 'TEST_KEY', createdAt: now, updatedAt: now });
    await repo.insertAgent({ id: agentId, name: 'Agent', modelRef: modelId, instructions: 'Test', createdAt: now, updatedAt: now });
    await repo.updateModel(modelId, { name: 'Updated model' });
    await repo.updateAgent(agentId, { enabled: false });

    for (let index = 0; index < 3; index += 1) {
      const sessionId = randomUUID();
      await repo.insertSession({ id: sessionId, agentId, title: `Session ${index}`, createdAt: now, updatedAt: `${now}-${index}` });
      await repo.insertRun({ id: randomUUID(), sessionId, agentId, status: 'completed', startedAt: `${now}-${index}` });
    }

    expect((await repo.getModel(modelId))?.name).toBe('Updated model');
    expect((await repo.getAgent(agentId))?.enabled).toBe(false);
    expect(await repo.listSessions(1, 1)).toHaveLength(1);
    expect(await repo.listRuns(0, 2)).toHaveLength(2);
  });
});
