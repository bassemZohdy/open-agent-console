import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';

describe('health endpoints', () => {
  it('reports healthy', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
