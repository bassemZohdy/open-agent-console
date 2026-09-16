export type ChatStreamEvent =
  | { version: 1; type: 'session'; sessionId: string; runId: string; correlationId: string }
  | { version: 1; type: 'token'; text: string }
  | { version: 1; type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { version: 1; type: 'done'; sessionId: string; runId: string }
  | { version: 1; type: 'cancelled'; sessionId: string; runId: string }
  | { version: 1; type: 'error'; message: string };

export function parseSseBuffer(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: ChatStreamEvent[] = [];

  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') continue;
    const candidate = parsed as { version?: unknown; type?: unknown };
    if (candidate.version !== 1 || typeof candidate.type !== 'string') continue;
    events.push(parsed as ChatStreamEvent);
  }

  return { events, rest };
}
