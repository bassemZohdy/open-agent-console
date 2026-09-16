import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from '../src/web/sse.js';

describe('parseSseBuffer', () => {
  it('parses complete versioned chat events and preserves a partial frame', () => {
    const input = [
      'event: session',
      'data: {"version":1,"type":"session","sessionId":"s1","runId":"r1","correlationId":"c1"}',
      '',
      'event: token',
      'data: {"version":1,"type":"token","text":"hello"}',
      '',
      'event: token',
      'data: {"version":1,"type":"token"',
    ].join('\n');

    const result = parseSseBuffer(input);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ type: 'session', sessionId: 's1' });
    expect(result.events[1]).toEqual({ version: 1, type: 'token', text: 'hello' });
    expect(result.rest).toContain('event: token');
  });

  it('ignores unversioned events', () => {
    const result = parseSseBuffer('data: {"type":"token","text":"legacy"}\n\n');
    expect(result.events).toEqual([]);
    expect(result.rest).toBe('');
  });
});
