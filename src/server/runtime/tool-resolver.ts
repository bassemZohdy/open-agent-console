import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Ajv } from "ajv";
import type { InferSelectModel } from "drizzle-orm";
import { RegistryRepository } from "../db/repository.js";
import type { mcpServers, tools } from "../db/schema.js";

type ToolRecord = InferSelectModel<typeof tools>;
type McpServerRecord = InferSelectModel<typeof mcpServers>;
type ResolvedTool = DynamicStructuredTool;

type HeaderConfig = Record<string, string | { env: string }>;

const ajv = new Ajv({ allErrors: true, strict: false });

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function runIdFromConfig(
  config: { metadata?: Record<string, unknown> } | undefined,
): string | undefined {
  const value = config?.metadata?.oacRunId;
  return typeof value === "string" ? value : undefined;
}

function stringifyOutput(value: unknown, max = 20_000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

function wrapRecordedTool(
  repository: RegistryRepository,
  record: ToolRecord,
  inner: ResolvedTool,
): ResolvedTool {
  return new DynamicStructuredTool({
    name: inner.name,
    description: inner.description,
    schema: inner.schema,
    func: async (input, _runManager, config) => {
      const runId = runIdFromConfig(config);
      const callId = randomUUID();
      const startedAt = new Date().toISOString();
      if (runId) {
        await repository.insertToolCall({
          id: callId,
          runId,
          toolId: record.id,
          toolName: record.name,
          status: "running",
          inputJson: JSON.stringify(input),
          startedAt,
        });
      }
      try {
        const result = await inner.invoke(input, config);
        if (runId)
          await repository.updateToolCall(callId, {
            status: "completed",
            output: stringifyOutput(result),
            completedAt: new Date().toISOString(),
          });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tool execution failed";
        if (runId)
          await repository.updateToolCall(callId, {
            status: "failed",
            error: message,
            completedAt: new Date().toISOString(),
          });
        throw error;
      }
    },
  });
}

function tokenize(expression: string): string[] {
  const compact = expression.replace(/\s+/g, "");
  if (!compact || compact.length > 200 || !/^[0-9+\-*/().]+$/.test(compact))
    throw new Error("Expression contains unsupported characters");
  return compact.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
}

function calculate(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  const primary = (): number => {
    const token = take();
    if (token === "(") {
      const value = addSub();
      if (take() !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token === "+" || token === "-") {
      const value = primary();
      return token === "-" ? -value : value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  };

  const mulDiv = (): number => {
    let value = primary();
    while (peek() === "*" || peek() === "/") {
      const op = take();
      const right = primary();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };

  function addSub(): number {
    let value = mulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const right = mulDiv();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = addSub();
  if (index !== tokens.length || !Number.isFinite(result))
    throw new Error("Invalid expression");
  return result;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4?.[1]) return isPrivateAddress(mappedIpv4[1]);
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

type PublicHttpTarget = { url: URL; address: string; family: 4 | 6 };

async function resolvePublicHttpTarget(rawUrl: string): Promise<PublicHttpTarget> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  if (url.username || url.password)
    throw new Error("Credentials in URLs are not allowed");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  )
    throw new Error(
      "HTTP tool target resolves to a private or restricted network address",
    );
  const selected = addresses[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6))
    throw new Error("HTTP tool target has no supported public address");
  return { url, address: selected.address, family: selected.family };
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  return (await resolvePublicHttpTarget(rawUrl)).url;
}

async function fetchPinned<T>(target: PublicHttpTarget, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) =>
        callback(null, target.address, target.family),
    } as never,
  });
  try {
    const response = await fetch(target.url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });
    return await consume(response);
  } finally {
    await dispatcher.close();
  }
}

function resolveHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as HeaderConfig)) {
    if (typeof value === "string") headers[key] = value;
    else if (
      value &&
      typeof value === "object" &&
      typeof value.env === "string"
    ) {
      const secret = process.env[value.env];
      if (!secret)
        throw new Error(
          `Header credential environment variable ${value.env} is not configured`,
        );
      headers[key] = secret;
    }
  }
  return headers;
}

function createBuiltin(record: ToolRecord): ResolvedTool {
  if (record.kind === "builtin-calculator") {
    return new DynamicStructuredTool({
      name: record.name,
      description: record.description,
      schema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "Arithmetic expression using +, -, *, / and parentheses",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
      func: async (input) => {
        const expression = (input as Record<string, unknown>).expression;
        if (typeof expression !== "string")
          throw new Error("expression must be a string");
        return String(calculate(expression));
      },
    });
  }
  return new DynamicStructuredTool({
    name: record.name,
    description: record.description,
    schema: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description: "Optional IANA timezone, e.g. Asia/Dubai",
        },
      },
      additionalProperties: false,
    },
    func: async (input) => {
      const timeZone = (input as Record<string, unknown>).timeZone;
      const options: Intl.DateTimeFormatOptions = {
        dateStyle: "full",
        timeStyle: "long",
      };
      if (typeof timeZone === "string" && timeZone) options.timeZone = timeZone;
      try {
        return new Intl.DateTimeFormat("en", options).format(new Date());
      } catch {
        throw new Error("Invalid IANA timezone");
      }
    },
  });
}

function createHttpTool(record: ToolRecord): ResolvedTool {
  const config = parseObject(record.configJson, "HTTP tool config");
  const inputSchema = parseObject(
    record.inputSchemaJson,
    "HTTP tool input schema",
  );
  const validate = ajv.compile(inputSchema);
  return new DynamicStructuredTool({
    name: record.name,
    description: record.description,
    schema: inputSchema,
    func: async (input) => {
      if (!validate(input))
        throw new Error(
          `Invalid tool input: ${ajv.errorsText(validate.errors)}`,
        );
      const rawUrl = config.url;
      if (typeof rawUrl !== "string")
        throw new Error("HTTP tool URL is not configured");
      const target = await resolvePublicHttpTarget(rawUrl);
      const url = target.url;
      const method =
        typeof config.method === "string" ? config.method.toUpperCase() : "GET";
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
        throw new Error("Unsupported HTTP method");
      const timeoutMs =
        typeof config.timeoutMs === "number"
          ? Math.min(Math.max(config.timeoutMs, 1000), 60_000)
          : 10_000;
      const maxOutputChars =
        typeof config.maxOutputChars === "number"
          ? Math.min(Math.max(config.maxOutputChars, 1000), 100_000)
          : 20_000;
      const headers = resolveHeaders(config.headers);
      const bodyInput = input as Record<string, unknown>;
      if (method === "GET") {
        for (const [key, value] of Object.entries(bodyInput))
          if (["string", "number", "boolean"].includes(typeof value))
            url.searchParams.set(key, String(value));
      } else {
        headers["content-type"] ??= "application/json";
      }
      const response = await fetchPinned(target, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(bodyInput),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      }, async (result) => ({ ok: result.ok, status: result.status, text: await result.text() }));
      const text = response.text;
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 1000)}`);
      return text.length > maxOutputChars
        ? `${text.slice(0, maxOutputChars)}\n[truncated]`
        : text;
    },
  });
}

function mcpHeaders(server: McpServerRecord): Record<string, string> {
  return resolveHeaders(parseObject(server.headersJson, "MCP server headers"));
}

export type ResolvedTools = {
  tools: ResolvedTool[];
  dispose: () => Promise<void>;
};

export async function resolveTools(
  repository: RegistryRepository,
  agentId: string,
): Promise<ResolvedTools> {
  const mappings = await repository.listAgentTools(agentId);
  const resolved: ResolvedTool[] = [];
  const clients: MultiServerMCPClient[] = [];

  for (const { tool: record } of mappings) {
    if (!record.enabled) continue;
    if (
      record.kind === "builtin-calculator" ||
      record.kind === "builtin-datetime"
    ) {
      resolved.push(
        wrapRecordedTool(repository, record, createBuiltin(record)),
      );
      continue;
    }
    if (record.kind === "http") {
      resolved.push(
        wrapRecordedTool(repository, record, createHttpTool(record)),
      );
      continue;
    }
    if (record.kind === "mcp") {
      if (!record.mcpServerId || !record.externalName) continue;
      const server = await repository.getMcpServer(record.mcpServerId);
      if (!server?.enabled) continue;
      await assertPublicHttpUrl(server.url);
      const client = new MultiServerMCPClient({
        throwOnLoadError: true,
        prefixToolNameWithServerName: false,
        useStandardContentBlocks: true,
        mcpServers: {
          [server.id]: {
            transport: "http",
            url: server.url,
            headers: mcpHeaders(server),
          },
        },
      });
      clients.push(client);
      const found = (await client.getTools()).find(
        (tool) => tool.name === record.externalName,
      );
      if (!found)
        throw new Error(
          `MCP tool ${record.externalName} is no longer exposed by ${server.name}`,
        );
      resolved.push(wrapRecordedTool(repository, record, found));
    }
  }

  return {
    tools: resolved,
    dispose: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

export async function discoverMcpTools(
  server: McpServerRecord,
): Promise<Array<{ name: string; description: string }>> {
  await assertPublicHttpUrl(server.url);
  const client = new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    useStandardContentBlocks: true,
    mcpServers: {
      [server.id]: {
        transport: "http",
        url: server.url,
        headers: mcpHeaders(server),
      },
    },
  });
  try {
    const discovered = await client.getTools();
    return discovered.map((tool) => ({
      name: tool.name,
      description: tool.description || tool.name,
    }));
  } finally {
    await client.close();
  }
}
