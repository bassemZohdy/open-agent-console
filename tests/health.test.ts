import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { createDatabase } from '../src/server/db/index.js';
import { RegistryRepository } from '../src/server/db/repository.js';

describe('health endpoints', () => {
  it('reports healthy', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('accepts an injected repository and sqlite connection', async () => {
    const connection = createDatabase(':memory:');
    const app = buildApp({
      repository: new RegistryRepository(connection.db),
      sqlite: connection.sqlite,
    });
    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(response.statusCode).toBe(200);
    await app.close();
    connection.sqlite.close();
  });
});
