import { createHash, randomUUID } from "node:crypto";
import type { InferSelectModel } from "drizzle-orm";
import { a2aExposures, a2aTasks } from "../db/schema.js";
import { RegistryRepository } from "../db/repository.js";
import { AgentRuntimeManager, type StreamEvent } from "./agent-runtime-manager.js";

type Exposure = InferSelectModel<typeof a2aExposures>;
type TaskRow = InferSelectModel<typeof a2aTasks>;
type A2aMessage = {
  messageId: string;
  role: "ROLE_USER" | "user";
  parts: Array<{ text?: string; raw?: unknown; url?: string }>;
  contextId?: string;
  taskId?: string;
};

export const a2aTaskStates = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

export class A2aTaskError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export type A2aTaskPayload = {
  id: string;
  contextId: string;
  status: {
    state: string;
    timestamp: string;
    message?: { messageId: string; role: string; parts: Array<{ text: string }> };
  };
  history: Array<{ messageId: string; role: string; parts: Array<{ text: string }> }>;
  artifacts: Array<{ artifactId: string; name: string; parts: Array<{ text: string }>; lastChunk: boolean }>;
  metadata: Record<string, never>;
};

export type A2aTaskEvent =
  | { type: "status"; task: A2aTaskPayload; final: boolean }
  | { type: "artifact"; taskId: string; contextId: string; artifact: A2aTaskPayload["artifacts"][number]; lastChunk: boolean };

function parseInput(row: TaskRow): A2aMessage | undefined {
  try {
    const parsed = JSON.parse(row.inputJson) as { message?: A2aMessage };
    return parsed.message;
  } catch {
    return undefined;
  }
}

function textFromMessage(message: A2aMessage): string {
  return message.parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function messagePayload(message: A2aMessage | undefined, role: "ROLE_USER" | "ROLE_AGENT", text: string) {
  return {
    messageId: message?.messageId ?? randomUUID(),
    role,
    parts: [{ text }],
  };
}

function terminal(state: string): boolean {
  return ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED"].includes(state);
}

export function callerFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class A2aTaskManager {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly subscribers = new Map<string, Set<(event: A2aTaskEvent) => void>>();

  constructor(
    private readonly repository: RegistryRepository,
    private readonly runtime: AgentRuntimeManager,
  ) {
    void this.recoverInterruptedTasks();
  }

  private async recoverInterruptedTasks(): Promise<void> {
    const exposures = await this.repository.listA2aExposures();
    for (const exposure of exposures) {
      const rows = await this.repository.listA2aTasks(exposure.id, { limit: 10_000 });
      for (const row of rows) {
        if (!terminal(row.state)) {
          await this.repository.updateA2aTask(row.id, {
            state: "TASK_STATE_FAILED",
            errorCode: "SERVICE_RESTARTED",
            errorMessage: "The task was interrupted by a service restart",
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  toTaskPayload(row: TaskRow): A2aTaskPayload {
    const input = parseInput(row);
    const inputText = input ? textFromMessage(input) : "";
    const history = inputText ? [messagePayload(input, "ROLE_USER", inputText)] : [];
    if (row.outputText) history.push(messagePayload(undefined, "ROLE_AGENT", row.outputText));
    const status: A2aTaskPayload["status"] = {
      state: row.state,
      timestamp: row.updatedAt,
      ...(row.errorMessage
        ? { message: messagePayload(undefined, "ROLE_AGENT", row.errorMessage) }
        : {}),
    };
    return {
      id: row.id,
      contextId: row.contextId,
      status,
      history,
      artifacts: row.outputText
        ? [{ artifactId: `${row.id}-response`, name: "response", parts: [{ text: row.outputText }], lastChunk: true }]
        : [],
      metadata: {},
    };
  }

  private notify(event: A2aTaskEvent): void {
    for (const subscriber of this.subscribers.get(event.type === "status" ? event.task.id : event.taskId) ?? []) subscriber(event);
  }

  private async record(exposureId: string, taskId: string | null, action: string, callerHash?: string, metadata: Record<string, unknown> = {}) {
    await this.repository.insertA2aAuditEvent({
      id: randomUUID(),
      exposureId,
      taskId,
      actorType: callerHash ? "a2a-caller" : "system",
      action,
      callerHash: callerHash ?? null,
      metadataJson: JSON.stringify(metadata),
      createdAt: new Date().toISOString(),
    });
  }

  private async publishStatus(row: TaskRow, final = terminal(row.state)): Promise<void> {
    this.notify({ type: "status", task: this.toTaskPayload(row), final });
  }

  async submit(exposure: Exposure, message: A2aMessage, callerHash: string, correlationId: string): Promise<A2aTaskPayload> {
    const duplicate = await this.repository.getA2aTaskByMessageId(exposure.id, message.messageId);
    if (duplicate) {
      if (duplicate.callerHash !== callerHash) throw new A2aTaskError("The message ID is already in use", "IDEMPOTENCY_KEY_CONFLICT", 409);
      return this.toTaskPayload(duplicate);
    }
    const text = textFromMessage(message);
    if (!text) throw new A2aTaskError("Only text parts are supported by this exposure", "UNSUPPORTED_INPUT_MODE", 400);
    if (await this.repository.countA2aTasks(exposure.id) >= exposure.maxConcurrentTasks)
      throw new A2aTaskError("The exposure has reached its concurrent task limit", "TASK_QUOTA_EXCEEDED", 429);

    let contextId = message.contextId ?? randomUUID();
    let parentTaskId: string | null = null;
    let sessionId: string | null = null;
    if (message.taskId) {
      const parent = await this.repository.getA2aTask(message.taskId);
      if (!parent || parent.exposureId !== exposure.id) throw new A2aTaskError("Task not found", "TASK_NOT_FOUND", 404);
      if (parent.callerHash !== callerHash) throw new A2aTaskError("Task is not available to this caller", "TASK_ACCESS_DENIED", 404);
      if (message.contextId && message.contextId !== parent.contextId) throw new A2aTaskError("The context ID does not match the task", "CONTEXT_ID_MISMATCH", 400);
      contextId = parent.contextId;
      parentTaskId = parent.id;
      sessionId = parent.sessionId;
    }

    const now = new Date().toISOString();
    const taskId = randomUUID();
    const row = {
      id: taskId,
      exposureId: exposure.id,
      contextId,
      parentTaskId,
      clientMessageId: message.messageId,
      sessionId,
      runId: null,
      state: "TASK_STATE_SUBMITTED",
      inputJson: JSON.stringify({ message }),
      outputText: null,
      errorCode: null,
      errorMessage: null,
      callerHash,
      correlationId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    } satisfies typeof a2aTasks.$inferInsert;
    try {
      await this.repository.insertA2aTask(row);
    } catch (error) {
      const conflict = await this.repository.getA2aTaskByMessageId(exposure.id, message.messageId);
      if (conflict) return this.toTaskPayload(conflict);
      throw error;
    }
    await this.record(exposure.id, taskId, "task.submitted", callerHash, { contextId });
    void this.process(exposure, taskId, text, sessionId);
    return this.toTaskPayload(row);
  }

  private async process(exposure: Exposure, taskId: string, text: string, sessionId: string | null): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);
    const timer = setTimeout(() => controller.abort(), exposure.maxTaskSeconds * 1000);
    let current = await this.repository.getA2aTask(taskId);
    if (!current) return;
    try {
      await this.repository.updateA2aTask(taskId, { state: "TASK_STATE_WORKING", updatedAt: new Date().toISOString() });
      current = await this.repository.getA2aTask(taskId);
      if (!current) return;
      await this.record(exposure.id, taskId, "task.started", current.callerHash);
      await this.publishStatus(current);
      let output = "";
      let finalSessionId = sessionId;
      let finalRunId: string | null = null;
      for await (const event of this.runtime.stream(exposure.agentId, sessionId ?? undefined, text, { signal: controller.signal, correlationId: current.correlationId })) {
        const typed = event as StreamEvent;
        if (typed.type === "session") {
          finalSessionId = typed.sessionId;
          finalRunId = typed.runId;
          await this.repository.updateA2aTask(taskId, { sessionId: typed.sessionId, runId: typed.runId, updatedAt: new Date().toISOString() });
        } else if (typed.type === "token") {
          output += typed.text;
        } else if (typed.type === "cancelled") {
          await this.finish(exposure, taskId, "TASK_STATE_CANCELED", undefined, "TASK_CANCELED", "The task was canceled", finalSessionId, finalRunId);
          return;
        } else if (typed.type === "error") {
          await this.finish(exposure, taskId, "TASK_STATE_FAILED", undefined, typed.code ?? "AGENT_EXECUTION_FAILED", "Agent execution failed", finalSessionId, finalRunId);
          return;
        }
      }
      const row = await this.repository.getA2aTask(taskId);
      if (!row || row.state === "TASK_STATE_CANCELED") return;
      await this.finish(exposure, taskId, "TASK_STATE_COMPLETED", output, undefined, undefined, finalSessionId, finalRunId);
    } catch (error) {
      const row = await this.repository.getA2aTask(taskId);
      if (!row || terminal(row.state)) return;
      await this.finish(exposure, taskId, controller.signal.aborted ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED", undefined, controller.signal.aborted ? "TASK_CANCELED" : "AGENT_EXECUTION_FAILED", controller.signal.aborted ? "The task was canceled" : "Agent execution failed", row.sessionId, row.runId);
      if (!controller.signal.aborted) await this.record(exposure.id, taskId, "task.failed", row.callerHash, { reason: error instanceof Error ? error.name : "unknown" });
    } finally {
      clearTimeout(timer);
      this.abortControllers.delete(taskId);
    }
  }

  private async finish(exposure: Exposure, taskId: string, state: string, outputText?: string, errorCode?: string, errorMessage?: string, sessionId?: string | null, runId?: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.repository.updateA2aTask(taskId, { state, outputText: outputText ?? null, errorCode: errorCode ?? null, errorMessage: errorMessage ?? null, sessionId: sessionId ?? undefined, runId: runId ?? undefined, completedAt: now, updatedAt: now });
    const row = await this.repository.getA2aTask(taskId);
    if (!row) return;
    await this.record(exposure.id, taskId, state === "TASK_STATE_COMPLETED" ? "task.completed" : state === "TASK_STATE_CANCELED" ? "task.canceled" : "task.failed", row.callerHash);
    if (outputText) {
      const artifact = this.toTaskPayload(row).artifacts[0];
      if (artifact) this.notify({ type: "artifact", taskId: row.id, contextId: row.contextId, artifact, lastChunk: true });
    }
    await this.publishStatus(row, true);
  }

  async get(exposureId: string, taskId: string, callerHash: string): Promise<A2aTaskPayload> {
    const row = await this.repository.getA2aTask(taskId);
    if (!row || row.exposureId !== exposureId || row.callerHash !== callerHash) throw new A2aTaskError("Task not found", "TASK_NOT_FOUND", 404);
    return this.toTaskPayload(row);
  }

  async list(exposureId: string, callerHash: string, contextId?: string, limit = 50, offset = 0): Promise<{ tasks: A2aTaskPayload[]; nextPageToken?: string }> {
    const rows = (await this.repository.listA2aTasks(exposureId, { contextId, limit: limit + 1, offset })).filter((row) => row.callerHash === callerHash);
    const page = rows.slice(0, limit);
    return { tasks: page.map((row) => this.toTaskPayload(row)), ...(rows.length > limit ? { nextPageToken: String(offset + limit) } : {}) };
  }

  async cancel(exposureId: string, taskId: string, callerHash: string): Promise<A2aTaskPayload> {
    const row = await this.repository.getA2aTask(taskId);
    if (!row || row.exposureId !== exposureId || row.callerHash !== callerHash) throw new A2aTaskError("Task not found", "TASK_NOT_FOUND", 404);
    if (terminal(row.state)) return this.toTaskPayload(row);
    this.abortControllers.get(taskId)?.abort();
    await this.finish((await this.repository.getA2aExposure(exposureId)) as Exposure, taskId, "TASK_STATE_CANCELED", undefined, "TASK_CANCELED", "The task was canceled", row.sessionId, row.runId);
    return this.get(exposureId, taskId, callerHash);
  }

  async *subscribe(exposureId: string, taskId: string, callerHash: string): AsyncGenerator<A2aTaskEvent> {
    const initial = await this.repository.getA2aTask(taskId);
    if (!initial || initial.exposureId !== exposureId || initial.callerHash !== callerHash) throw new A2aTaskError("Task not found", "TASK_NOT_FOUND", 404);
    const first = { type: "status", task: this.toTaskPayload(initial), final: terminal(initial.state) } as const;
    yield first;
    if (first.final) return;
    const queue: A2aTaskEvent[] = [];
    let resolve: (() => void) | undefined;
    const subscriber = (event: A2aTaskEvent) => {
      queue.push(event);
      resolve?.();
      resolve = undefined;
    };
    const subscribers = this.subscribers.get(taskId) ?? new Set<(event: A2aTaskEvent) => void>();
    subscribers.add(subscriber);
    this.subscribers.set(taskId, subscribers);
    try {
      while (true) {
        const event = queue.shift() ?? await new Promise<A2aTaskEvent>((wait) => {
          resolve = () => wait(queue.shift() as A2aTaskEvent);
        });
        yield event;
        if (event.type === "status" && event.final) return;
      }
    } finally {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.subscribers.delete(taskId);
    }
  }
}
