import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';

describe('registry lifecycle APIs', () => {
  it('supports updates, pagination and safe referential deletion', async () => {
    const app = buildApp();
    const suffix = crypto.randomUUID().slice(0, 8);

    const modelResponse = await app.inject({
      method: 'POST',
      url: '/api/models',
      payload: {
        name: `Model ${suffix}`,
        provider: 'ollama',
        modelId: 'qwen3',
        baseUrl: 'http://127.0.0.1:11434',
        apiKeyEnv: '',
        capabilities: ['streaming'],
        timeoutMs: 10000,
        maxRetries: 0,
      },
    });
    expect(modelResponse.statusCode).toBe(201);
    const model = modelResponse.json() as { id: string };

    const agentResponse = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: `Agent ${suffix}`,
        modelRef: model.id,
        instructions: 'Be concise.',
        maxModelCalls: 3,
        maxToolCalls: 5,
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json() as { id: string };

    const disableResponse = await app.inject({ method: 'PATCH', url: `/api/agents/${agent.id}/enabled`, payload: { enabled: false } });
    expect(disableResponse.statusCode).toBe(200);

    const blockedDelete = await app.inject({ method: 'DELETE', url: `/api/models/${model.id}` });
    expect(blockedDelete.statusCode).toBe(409);
    expect((blockedDelete.json() as { error: string }).error).toContain('referenced');

    const sessions = await app.inject({ method: 'GET', url: '/api/sessions?offset=0&limit=5' });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json()).toMatchObject({ offset: 0, limit: 5 });

    expect((await app.inject({ method: 'DELETE', url: `/api/agents/${agent.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/models/${model.id}` })).statusCode).toBe(204);
    await app.close();
  });
});
