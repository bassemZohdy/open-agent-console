import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { Ajv } from "ajv";
import { ZodError } from "zod";
import { sqlite } from "./db/index.js";
import { RegistryRepository } from "./db/repository.js";
import {
  agentMappingsSchema,
  createA2aExposureSchema,
  a2aSendMessageSchema,
  a2aTaskQuerySchema,
  chatRequestSchema,
  createAgentSchema,
  createModelSchema,
  memoryConnectorSchema,
  memorySchema,
  mcpServerSchema,
  registryImportSchema,
  runQuerySchema,
  sessionQuerySchema,
  skillSchema,
  toolSchema,
  updateAgentSchema,
  updateA2aExposureSchema,
  updateMemorySchema,
  updateMemoryConnectorSchema,
  updateMcpServerSchema,
  updateSkillSchema,
  updateSessionSchema,
  updateToolSchema,
  updateModelSchema,
  loginSchema,
} from "./domain/schemas.js";
import {
  assertPublicHttpUrl,
  discoverMcpTools,
} from "./runtime/tool-resolver.js";
import { testModelConnection } from "./runtime/model-factory.js";
import { A2aTaskError, A2aTaskManager, callerFingerprint } from "./runtime/a2a-task-manager.js";
import { appVersion } from "./version.js";
import {
  resolveAppDependencies,
  credentialDigest,
  type AccessRole,
  type AppDependencies,
  type AuthAccount,
  type AuthConfig,
} from "./app-dependencies.js";

const ajv = new Ajv({ allErrors: true, strict: false });

class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly errorCode: string,
  ) {
    super(message);
  }
}

function parseJson(
  value: string,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback;
  } catch {
    return fallback;
  }
}

function capabilities(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function modelPayload(row: unknown) {
  if (!row || typeof row !== "object") return row;
  const record = row as Record<string, unknown>;
  const { capabilitiesJson, ...rest } = record;
  return {
    ...rest,
    capabilities: capabilities(
      typeof capabilitiesJson === "string" ? capabilitiesJson : "[]",
    ),
  };
}
function skillPayload(row: unknown) {
  return row;
}
function toolPayload(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const record = row as Record<string, unknown>;
  const { configJson, inputSchemaJson, ...rest } = record;
  return {
    ...rest,
    config: parseJson(typeof configJson === "string" ? configJson : "{}"),
    inputSchema: parseJson(
      typeof inputSchemaJson === "string" ? inputSchemaJson : "{}",
    ),
  };
}
function mcpPayload(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const record = row as Record<string, unknown>;
  const { headersJson, ...rest } = record;
  return {
    ...rest,
    headers: parseJson(typeof headersJson === "string" ? headersJson : "{}"),
  };
}
function memoryConnectorPayload(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const record = row as Record<string, unknown>;
  const { configJson, ...rest } = record;
  return {
    ...rest,
    config: parseJson(typeof configJson === "string" ? configJson : "{}"),
  };
}
function memoryPayload(row: unknown) {
  if (!row || typeof row !== "object") return row;
  const record = row as Record<string, unknown>;
  const { metadataJson, ...rest } = record;
  return {
    ...rest,
    metadata: parseJson(typeof metadataJson === "string" ? metadataJson : "{}"),
  };
}

function a2aExposurePayload(row: unknown, agent?: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  const record = row as Record<string, unknown>;
  const agentReady = Boolean(agent && typeof agent === "object" && (agent as Record<string, unknown>).enabled !== false);
  const transportReady = Boolean(
    record.published &&
      record.enabled !== false &&
      agentReady &&
      (record.authMode === "none" || (typeof record.authEnv === "string" && Boolean(process.env[record.authEnv]))),
  );
  return {
    ...record,
    status: !record.published ? "draft" : record.enabled === false ? "paused" : transportReady ? "published" : "unavailable",
    transportReady,
    ...(agent && typeof agent === "object"
      ? {
          agent: {
            id: (agent as Record<string, unknown>).id,
            name: (agent as Record<string, unknown>).name,
            description: (agent as Record<string, unknown>).description,
            accessLevel: (agent as Record<string, unknown>).accessLevel,
            enabled: (agent as Record<string, unknown>).enabled,
          },
        }
      : {}),
  };
}

async function agentPayload(
  repository: RegistryRepository,
  row: unknown,
  role: AccessRole = "admin",
) {
  if (!row) return row;
  const record = row as Record<string, unknown> & { id: string };
  const [orderedSkills, orderedTools] = await Promise.all([
    repository.listAgentSkills(record.id),
    repository.listAgentTools(record.id),
  ]);
  const payload = {
    ...record,
    skillIds: orderedSkills.map(({ skill }) => skill.id),
    toolIds: orderedTools.map(({ tool }) => tool.id),
  };
  if (role === "admin") return payload;
  const publicPayload = { ...payload } as Record<string, unknown>;
  for (const key of [
    "instructions",
    "skillIds",
    "toolIds",
    "memoryConnectorId",
    "temperature",
    "maxTokens",
    "maxModelCalls",
    "maxToolCalls",
  ])
    delete publicPayload[key];
  return publicPayload;
}

async function validateAgentReferences(
  repository: RegistryRepository,
  skillIds: string[],
  toolIds: string[],
  memoryConnectorId: string | null | undefined,
) {
  const [allSkills, allTools] = await Promise.all([
    repository.listSkills(),
    repository.listTools(),
  ]);
  const skillSet = new Set(allSkills.map((skill) => skill.id));
  const toolSet = new Set(allTools.map((tool) => tool.id));
  if (skillIds.some((id) => !skillSet.has(id)))
    throw new Error("One or more selected skills do not exist");
  if (toolIds.some((id) => !toolSet.has(id)))
    throw new Error("One or more selected tools do not exist");
  if (
    memoryConnectorId &&
    !(await repository.getMemoryConnector(memoryConnectorId))
  )
    throw new Error("Selected memory connector does not exist");
}
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function redactHeaders(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { env?: unknown }).env === "string",
    ),
  );
}
function safeToolConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const secretKey = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;
  const redact = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((entry) => redact(entry));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !secretKey.test(key))
        .map(([key, entry]) => [key, key === "headers" ? redactHeaders(entry) : redact(entry)]),
    );
  };
  return redact(value) as Record<string, unknown>;
}

async function withSqliteTransaction<T>(connection: typeof sqlite, work: () => Promise<T>): Promise<T> {
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = await work();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

const adminResourceRoots = [
  "/api/models",
  "/api/agents",
  "/api/a2a",
  "/api/skills",
  "/api/tools",
  "/api/mcp-servers",
  "/api/memory-connectors",
  "/api/registry",
];

type AgentAccessLevel = "admin" | "user" | "guest";

function normalizedAgentAccess(value: unknown): AgentAccessLevel {
  return value === "admin" || value === "guest" ? value : "user";
}

function canAccessAgent(role: AccessRole, accessLevel: unknown): boolean {
  const level = normalizedAgentAccess(accessLevel);
  if (role === "admin") return true;
  if (role === "user") return level !== "admin";
  return level === "guest";
}

function isAdminOnlyRequest(method: string, requestUrl: string): boolean {
  const pathname = requestUrl.split("?", 1)[0] ?? requestUrl;
  if (pathname === "/api/settings") return true;
  if (pathname === "/api/registry/export") return true;
  if (pathname === "/api/a2a" || pathname.startsWith("/api/a2a/")) return true;
  if (/^\/api\/agents\/[^/]+\/chat$/.test(pathname)) return false;
  if (method === "GET") return false;
  if (pathname === "/api/agents" && method === "POST") return true;
  return adminResourceRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

type AuthSession = {
  username: string;
  role: AccessRole;
  expiresAt: number;
};

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || undefined;
  }
  return undefined;
}

function sessionCookie(
  config: AuthConfig,
  token: string,
  maxAge: number,
): string {
  return [
    `${config.cookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.trunc(maxAge))}`,
    ...(config.secureCookie ? ["Secure"] : []),
  ].join("; ");
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function roleCapabilities(role: AccessRole): string[] {
  return role === "admin"
    ? ["operate", "configure", "transfer"]
    : role === "user"
      ? ["operate", "chat", "review"]
      : ["chat"];
}

function accountFor(
  accounts: AuthAccount[],
  username: string,
  password: string,
): AuthAccount | undefined {
  const account = accounts.find((candidate) => candidate.username === username);
  return account && sameDigest(account.passwordDigest, credentialDigest(password))
    ? account
    : undefined;
}

export function buildApp(options: AppDependencies = {}) {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  app.addContentTypeParser("application/a2a+json", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  const {
    repository,
    runtime,
    sqlite: sqliteConnection,
    role: fallbackRole,
    auth,
  } = resolveAppDependencies(options);
  const a2aTasks = new A2aTaskManager(repository, runtime);
  const a2aRateBuckets = new Map<string, number[]>();
  const sessions = new Map<string, AuthSession>();
  const authEnabled = auth.accounts.length > 0;
  const publicApiPaths = new Set([
    "/api/health",
    "/api/ready",
    "/api/auth/me",
    "/api/auth/login",
    "/api/auth/logout",
  ]);
  const currentSession = (request: { headers: { cookie?: string } }) => {
    const token = cookieValue(request.headers.cookie, auth.cookieName);
    const session = token ? sessions.get(token) : undefined;
    if (session && session.expiresAt <= Date.now()) {
      sessions.delete(token as string);
      return undefined;
    }
    return session;
  };
  const currentRole = (request: { headers: { cookie?: string } }): AccessRole =>
    currentSession(request)?.role ?? (authEnabled ? "guest" : fallbackRole);
  const isGuestWorkspaceRequest = (method: string, pathname: string): boolean =>
    (method === "GET" &&
      (pathname === "/api/agents" ||
        pathname === "/api/sessions" ||
        pathname === "/api/runs" ||
        /^\/api\/sessions\/[^/]+\/messages$/.test(pathname) ||
        /^\/api\/runs\/[^/]+$/.test(pathname))) ||
    (method === "DELETE" && /^\/api\/sessions\/[^/]+$/.test(pathname)) ||
    (method === "POST" && /^\/api\/agents\/[^/]+\/chat$/.test(pathname));
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-correlation-id", request.id);
  });
  app.addHook("preHandler", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? request.url;
    if (!pathname.startsWith("/api/")) return;
    const session = currentSession(request);
    if (
      authEnabled &&
      !publicApiPaths.has(pathname) &&
      !session &&
      !isGuestWorkspaceRequest(request.method, pathname)
    ) {
      return reply.code(401).send({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }
    const role = session?.role ?? (authEnabled ? "guest" : fallbackRole);
    if (role !== "admin" && isAdminOnlyRequest(request.method, request.url)) {
      return reply.code(403).send({
        error: "Admin role required for this operation",
        code: "FORBIDDEN",
      });
    }
    if (role === "admin") return;
    const agentMatch = /^\/api\/agents\/([^/]+)\/(chat|effective-prompt|memories(?:\/.*)?)$/.exec(pathname);
    if (agentMatch) {
      const agentId = agentMatch[1];
      const agent = agentId ? await repository.getAgent(agentId) : undefined;
      if (agent && (!canAccessAgent(role, agent.accessLevel) ||
        (role === "guest" && agentMatch[2] !== "chat"))) {
        return reply.code(403).send({
          error: "This agent is not available for the current role",
          code: "AGENT_ACCESS_DENIED",
        });
      }
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)/.exec(pathname);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const session = sessionId ? await repository.getSession(sessionId) : undefined;
      const agent = session ? await repository.getAgent(session.agentId) : undefined;
      if (agent && !canAccessAgent(role, agent.accessLevel)) {
        return reply.code(404).send({
          error: "Session not found",
          code: "SESSION_NOT_FOUND",
        });
      }
    }
    const runMatch = /^\/api\/runs\/([^/]+)/.exec(pathname);
    if (runMatch) {
      const runId = runMatch[1];
      const run = runId ? await repository.getRun(runId) : undefined;
      const agent = run ? await repository.getAgent(run.agentId) : undefined;
      if (agent && !canAccessAgent(role, agent.accessLevel)) {
        return reply.code(403).send({
          error: "This run is not available for the current role",
          code: "RUN_ACCESS_DENIED",
        });
      }
    }
  });
  const accessibleAgentIds = async (request: { headers: { cookie?: string } }) => {
    const role = currentRole(request);
    return role === "admin"
      ? undefined
      : (await repository.listAgents())
          .filter((agent) => canAccessAgent(role, agent.accessLevel))
          .map((agent) => agent.id);
  };
  const accessibleSession = async (
    request: { headers: { cookie?: string } },
    id: string,
  ) => {
    const session = await repository.getSession(id);
    if (!session) return undefined;
    const visibleIds = await accessibleAgentIds(request);
    return visibleIds && !visibleIds.includes(session.agentId) ? null : session;
  };
  app.setErrorHandler((error, request, reply) => {
    const correlationId = request.id;
    const sendError = (statusCode: number, code: string, message: string, details?: unknown) =>
      reply.code(statusCode).send({ error: message, code, correlationId, ...(details ? { details } : {}) });
    if (error instanceof ZodError)
      return sendError(400, "VALIDATION_FAILED", "Validation failed", error.issues);
    if (error instanceof SyntaxError)
      return sendError(400, "MALFORMED_JSON", "Malformed JSON payload");
    if (error instanceof AppError)
      return sendError(error.statusCode, error.errorCode, error.message);
    if (error instanceof A2aTaskError)
      return sendError(error.statusCode, error.code, error.message);
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED")
      return sendError(503, "DATABASE_BUSY", "Database is temporarily busy; retry the request");
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY")
      return sendError(409, "REFERENCE_CONFLICT", "Operation conflicts with referenced records");
    app.log.error(error);
    return sendError(500, "INTERNAL_ERROR", "Internal server error");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== "string") return payload;
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (!contentType.includes("application/json")) return payload;
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      if (typeof body.error !== "string" || typeof body.code === "string")
        return payload;
      return JSON.stringify({
        ...body,
        code: `HTTP_${reply.statusCode}`,
        correlationId: body.correlationId ?? request.id,
      });
    } catch {
      return payload;
    }
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (_request, reply) => {
    try {
      sqliteConnection.prepare("SELECT 1").get();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
  app.post("/api/auth/login", async (request, reply) => {
    if (!authEnabled)
      return reply.code(409).send({
        error: "Demo authentication is not configured",
        code: "AUTH_NOT_CONFIGURED",
      });
    const input = loginSchema.parse(request.body);
    const account = accountFor(auth.accounts, input.username, input.password);
    if (!account)
      return reply.code(401).send({
        error: "Invalid username or password",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, {
      username: account.username,
      role: account.role,
      expiresAt: Date.now() + auth.sessionTtlMs,
    });
    reply.header("Cache-Control", "no-store");
    reply.header(
      "Set-Cookie",
      sessionCookie(auth, token, Math.floor(auth.sessionTtlMs / 1000)),
    );
    return {
      authenticated: true,
      username: account.username,
      role: account.role,
      capabilities: roleCapabilities(account.role),
    };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const token = cookieValue(request.headers.cookie, auth.cookieName);
    if (token) sessions.delete(token);
    reply.header("Cache-Control", "no-store");
    reply.header("Set-Cookie", sessionCookie(auth, "", 0));
    return { authenticated: false };
  });
  app.get("/api/auth/me", async (request, reply) => {
    const session = currentSession(request);
    reply.header("Cache-Control", "no-store");
    if (authEnabled && !session)
      return {
        authenticated: false,
        capabilities: [],
      };
    const role = session?.role ?? fallbackRole;
    return {
      authenticated: true,
      username: session?.username ?? "local",
      role,
      capabilities: roleCapabilities(role),
    };
  });
  app.get("/api/settings", async () => ({
    application: "Open Agent Console",
    version: appVersion,
    runtime: "Node.js + LangChain",
    persistence: "SQLite",
    databaseFile: process.env.DB_FILE_NAME ?? "./data/open-agent-console.db",
    importExport:
      "Registry configuration only; secrets and memories are excluded from exports",
  }));

  app.get("/api/models", async () =>
    (await repository.listModels()).map(modelPayload),
  );
  app.post("/api/models", async (request, reply) => {
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
      capabilitiesJson: JSON.stringify(input.capabilities),
      timeoutMs: input.timeoutMs,
      maxRetries: input.maxRetries,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertModel(row);
    runtime.invalidateAll();
    return reply.code(201).send(modelPayload(row));
  });
  app.put("/api/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getModel(id);
    if (!current) return reply.code(404).send({ error: "Model not found" });
    const patch = updateModelSchema.parse(request.body);
    const merged = createModelSchema.parse({
      name: patch.name ?? current.name,
      provider: patch.provider ?? current.provider,
      modelId: patch.modelId ?? current.modelId,
      baseUrl: patch.baseUrl ?? current.baseUrl ?? "",
      apiKeyEnv: patch.apiKeyEnv ?? current.apiKeyEnv,
      temperature: patch.temperature ?? current.temperature ?? undefined,
      maxTokens: patch.maxTokens ?? current.maxTokens ?? undefined,
      capabilities:
        patch.capabilities ?? capabilities(current.capabilitiesJson),
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      maxRetries: patch.maxRetries ?? current.maxRetries,
    });
    await repository.updateModel(id, {
      name: merged.name,
      provider: merged.provider,
      modelId: merged.modelId,
      baseUrl: merged.baseUrl || null,
      apiKeyEnv: merged.apiKeyEnv,
      temperature: merged.temperature ?? null,
      maxTokens: merged.maxTokens ?? null,
      capabilitiesJson: JSON.stringify(merged.capabilities),
      timeoutMs: merged.timeoutMs,
      maxRetries: merged.maxRetries,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return { ok: true };
  });
  app.delete("/api/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if ((await repository.listAgents()).some((agent) => agent.modelRef === id))
      return reply
        .code(409)
        .send({ error: "Model is referenced by one or more agents" });
    await repository.deleteModel(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });
  app.post("/api/models/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = await repository.getModel(id);
    if (!model) return reply.code(404).send({ error: "Model not found" });
    return { ok: true, ...(await testModelConnection(model)) };
  });

  app.get("/api/skills", async () =>
    (await repository.listSkills()).map(skillPayload),
  );
  app.post("/api/skills", async (request, reply) => {
    const input = skillSchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      ...input,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertSkill(row);
    runtime.invalidateAll();
    return reply.code(201).send(row);
  });
  app.put("/api/skills/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getSkill(id);
    if (!current) return reply.code(404).send({ error: "Skill not found" });
    const patch = updateSkillSchema.parse(request.body);
    const merged = skillSchema.parse({ ...current, ...patch });
    await repository.updateSkill(id, {
      name: merged.name,
      description: merged.description ?? null,
      instructions: merged.instructions,
      enabled: merged.enabled,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return { ok: true };
  });
  app.delete("/api/skills/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (
      (await repository.listAllAgentSkills()).some(
        (mapping) => mapping.skillId === id,
      )
    )
      return reply
        .code(409)
        .send({ error: "Skill is mapped to one or more agents" });
    await repository.deleteSkill(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });

  app.get("/api/tools", async () =>
    (await repository.listTools()).map(toolPayload),
  );
  async function validateTool(input: unknown) {
    const parsed = toolSchema.parse(input);
    if (
      parsed.kind === "mcp" &&
      !(await repository.getMcpServer(parsed.mcpServerId!))
    )
      throw new AppError("Selected MCP server does not exist", 400, "MCP_SERVER_NOT_FOUND");
    try {
      ajv.compile(parsed.inputSchema);
    } catch (error) {
      throw new AppError(
        `Invalid input schema: ${error instanceof Error ? error.message : "schema compilation failed"}`,
        400,
        "INVALID_TOOL_SCHEMA",
      );
    }
    if (parsed.kind === "http") {
      try {
        new URL(parsed.config.url as string);
      } catch {
        throw new AppError("HTTP tool URL is invalid", 400, "INVALID_TOOL_URL");
      }
    }
    return parsed;
  }
  app.post("/api/tools/validate", async (request, reply) => {
    try {
      await validateTool(request.body);
      return { valid: true };
    } catch (error) {
      return reply
        .code(400)
        .send({
          valid: false,
          error:
            error instanceof Error
              ? error.message
              : "Invalid tool configuration",
        });
    }
  });
  app.post("/api/tools", async (request, reply) => {
    const input = await validateTool(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      kind: input.kind,
      configJson: JSON.stringify(input.config),
      inputSchemaJson: JSON.stringify(input.inputSchema),
      mcpServerId: input.mcpServerId ?? null,
      externalName: input.externalName ?? null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertTool(row);
    runtime.invalidateAll();
    return reply.code(201).send(toolPayload(row));
  });
  app.put("/api/tools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getTool(id);
    if (!current) return reply.code(404).send({ error: "Tool not found" });
    const patch = updateToolSchema.parse(request.body);
    const merged = await validateTool({ ...toolPayload(current), ...patch });
    await repository.updateTool(id, {
      name: merged.name,
      description: merged.description,
      kind: merged.kind,
      configJson: JSON.stringify(merged.config),
      inputSchemaJson: JSON.stringify(merged.inputSchema),
      mcpServerId: merged.mcpServerId ?? null,
      externalName: merged.externalName ?? null,
      enabled: merged.enabled,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return { ok: true };
  });
  app.delete("/api/tools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (
      (await repository.listAllAgentTools()).some(
        (mapping) => mapping.toolId === id,
      )
    )
      return reply
        .code(409)
        .send({ error: "Tool is mapped to one or more agents" });
    await repository.deleteTool(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });

  app.get("/api/mcp-servers", async () =>
    (await repository.listMcpServers()).map(mcpPayload),
  );
  app.post("/api/mcp-servers", async (request, reply) => {
    const input = mcpServerSchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      url: input.url,
      headersJson: JSON.stringify(input.headers),
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertMcpServer(row);
    runtime.invalidateAll();
    return reply.code(201).send(mcpPayload(row));
  });
  app.put("/api/mcp-servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getMcpServer(id);
    if (!current)
      return reply.code(404).send({ error: "MCP server not found" });
    const patch = updateMcpServerSchema.parse(request.body);
    const merged = mcpServerSchema.parse({ ...mcpPayload(current), ...patch });
    await repository.updateMcpServer(id, {
      name: merged.name,
      url: merged.url,
      headersJson: JSON.stringify(merged.headers),
      enabled: merged.enabled,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return { ok: true };
  });
  app.post("/api/mcp-servers/:id/discover", async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await repository.getMcpServer(id);
    if (!server) return reply.code(404).send({ error: "MCP server not found" });
    try {
      await assertPublicHttpUrl(server.url);
      return { tools: await discoverMcpTools(server) };
    } catch (error) {
      return reply
        .code(502)
        .send({
          error:
            error instanceof Error ? error.message : "MCP discovery failed",
        });
    }
  });
  app.delete("/api/mcp-servers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if ((await repository.listTools()).some((tool) => tool.mcpServerId === id))
      return reply
        .code(409)
        .send({ error: "MCP server is referenced by one or more tools" });
    await repository.deleteMcpServer(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });

  app.get("/api/memory-connectors", async () =>
    (await repository.listMemoryConnectors()).map(memoryConnectorPayload),
  );
  app.post("/api/memory-connectors", async (request, reply) => {
    const input = memoryConnectorSchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      configJson: JSON.stringify(input.config),
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertMemoryConnector(row);
    return reply.code(201).send(memoryConnectorPayload(row));
  });
  app.put("/api/memory-connectors/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getMemoryConnector(id);
    if (!current)
      return reply.code(404).send({ error: "Memory connector not found" });
    const patch = updateMemoryConnectorSchema.parse(request.body);
    const merged = memoryConnectorSchema.parse({
      ...memoryConnectorPayload(current),
      ...patch,
    });
    await repository.updateMemoryConnector(id, {
      name: merged.name,
      type: merged.type,
      configJson: JSON.stringify(merged.config),
      enabled: merged.enabled,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAll();
    return { ok: true };
  });
  app.delete("/api/memory-connectors/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (
      (await repository.listAgents()).some(
        (agent) => agent.memoryConnectorId === id,
      )
    )
      return reply
        .code(409)
        .send({ error: "Memory connector is selected by one or more agents" });
    if (
      (await repository.listAllMemories()).some(
        (memory) => memory.connectorId === id,
      )
    )
      return reply
        .code(409)
        .send({ error: "Memory connector still has stored memories" });
    await repository.deleteMemoryConnector(id);
    runtime.invalidateAll();
    return reply.code(204).send();
  });

  app.get("/api/agents", async (request) => {
    const ids = await accessibleAgentIds(request);
    const role = currentRole(request);
    const rows = await repository.listAgents();
    return Promise.all(
      rows
        .filter((agent) => !ids || ids.includes(agent.id))
        .map((agent) => agentPayload(repository, agent, role)),
    );
  });
  async function saveAgent(
    input: ReturnType<typeof createAgentSchema.parse>,
    id?: string,
  ) {
    await validateAgentReferences(
      repository,
      unique(input.skillIds),
      unique(input.toolIds),
      input.memoryConnectorId,
    );
    const now = new Date().toISOString();
    if (id) {
      await repository.updateAgent(id, {
        name: input.name,
        description: input.description ?? null,
        modelRef: input.modelRef,
        memoryConnectorId: input.memoryConnectorId ?? null,
        accessLevel: input.accessLevel,
        instructions: input.instructions,
        temperature: input.temperature ?? null,
        maxTokens: input.maxTokens ?? null,
        maxModelCalls: input.maxModelCalls,
        maxToolCalls: input.maxToolCalls,
        updatedAt: now,
      });
      await repository.replaceAgentSkills(id, unique(input.skillIds));
      await repository.replaceAgentTools(id, unique(input.toolIds));
      runtime.invalidateAgent(id);
      return agentPayload(repository, await repository.getAgent(id));
    }
    const row = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      modelRef: input.modelRef,
      memoryConnectorId: input.memoryConnectorId ?? null,
      accessLevel: input.accessLevel,
      instructions: input.instructions,
      enabled: true,
      temperature: input.temperature ?? null,
      maxTokens: input.maxTokens ?? null,
      maxModelCalls: input.maxModelCalls,
      maxToolCalls: input.maxToolCalls,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertAgent(row);
    await repository.replaceAgentSkills(row.id, unique(input.skillIds));
    await repository.replaceAgentTools(row.id, unique(input.toolIds));
    return agentPayload(repository, row);
  }
  app.post("/api/agents", async (request, reply) => {
    const input = createAgentSchema.parse(request.body);
    if (!(await repository.getModel(input.modelRef)))
      return reply.code(400).send({ error: "Model does not exist" });
    try {
      return reply.code(201).send(await saveAgent(input));
    } catch (error) {
      return reply
        .code(400)
        .send({
          error:
            error instanceof Error ? error.message : "Invalid agent references",
        });
    }
  });
  app.put("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getAgent(id);
    if (!current) return reply.code(404).send({ error: "Agent not found" });
    const patch = updateAgentSchema.parse(request.body);
    const [currentSkills, currentTools] = await Promise.all([
      repository.listAgentSkills(id),
      repository.listAgentTools(id),
    ]);
    const merged = createAgentSchema.parse({
      name: patch.name ?? current.name,
      description: patch.description ?? current.description ?? undefined,
      modelRef: patch.modelRef ?? current.modelRef,
      memoryConnectorId:
        patch.memoryConnectorId === undefined
          ? current.memoryConnectorId
          : patch.memoryConnectorId,
      accessLevel: patch.accessLevel ?? normalizedAgentAccess(current.accessLevel),
      instructions: patch.instructions ?? current.instructions,
      temperature: patch.temperature ?? current.temperature ?? undefined,
      maxTokens: patch.maxTokens ?? current.maxTokens ?? undefined,
      maxModelCalls: patch.maxModelCalls ?? current.maxModelCalls,
      maxToolCalls: patch.maxToolCalls ?? current.maxToolCalls,
      skillIds: patch.skillIds ?? currentSkills.map(({ skill }) => skill.id),
      toolIds: patch.toolIds ?? currentTools.map(({ tool }) => tool.id),
    });
    if (!(await repository.getModel(merged.modelRef)))
      return reply.code(400).send({ error: "Model does not exist" });
    try {
      return reply.send(await saveAgent(merged, id));
    } catch (error) {
      return reply
        .code(400)
        .send({
          error:
            error instanceof Error ? error.message : "Invalid agent references",
        });
    }
  });
  async function updateMappings(
    agentId: string,
    kind: "skills" | "tools",
    body: unknown,
    reply: FastifyReply,
  ) {
    const agent = await repository.getAgent(agentId);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const input = agentMappingsSchema.parse(body);
    const skillIds =
      kind === "skills"
        ? unique(input.skillIds)
        : (await repository.listAgentSkills(agentId)).map(
            ({ skill }) => skill.id,
          );
    const toolIds =
      kind === "tools"
        ? unique(input.toolIds)
        : (await repository.listAgentTools(agentId)).map(({ tool }) => tool.id);
    try {
      await validateAgentReferences(
        repository,
        skillIds,
        toolIds,
        agent.memoryConnectorId,
      );
    } catch (error) {
      return reply
        .code(400)
        .send({
          error: error instanceof Error ? error.message : "Invalid mappings",
        });
    }
    if (kind === "skills")
      await repository.replaceAgentSkills(agentId, skillIds);
    else await repository.replaceAgentTools(agentId, toolIds);
    await repository.updateAgent(agentId, {
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAgent(agentId);
    return { ok: true, skillIds, toolIds };
  }
  app.put("/api/agents/:id/skills", async (request, reply) =>
    updateMappings(
      (request.params as { id: string }).id,
      "skills",
      request.body,
      reply,
    ),
  );
  app.put("/api/agents/:id/tools", async (request, reply) =>
    updateMappings(
      (request.params as { id: string }).id,
      "tools",
      request.body,
      reply,
    ),
  );
  app.get("/api/agents/:id/effective-prompt", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await repository.getAgent(id)))
      return reply.code(404).send({ error: "Agent not found" });
    return { agentId: id, prompt: await runtime.effectivePrompt(id) };
  });
  app.patch("/api/agents/:id/enabled", async (request, reply) => {
    const { id } = request.params as { id: string };
    const enabled = (request.body as { enabled?: unknown })?.enabled;
    if (typeof enabled !== "boolean")
      return reply.code(400).send({ error: "enabled must be boolean" });
    if (!(await repository.getAgent(id)))
      return reply.code(404).send({ error: "Agent not found" });
    await repository.updateAgent(id, {
      enabled,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAgent(id);
    return { ok: true };
  });
  app.post("/api/agents/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getAgent(id);
    if (!current) return reply.code(404).send({ error: "Agent not found" });
    const now = new Date().toISOString();
    const [skillRows, toolRows] = await Promise.all([
      repository.listAgentSkills(id),
      repository.listAgentTools(id),
    ]);
    const duplicate = {
      ...current,
      id: randomUUID(),
      name: `${current.name} Copy`,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertAgent(duplicate);
    await repository.replaceAgentSkills(
      duplicate.id,
      skillRows.map(({ skill }) => skill.id),
    );
    await repository.replaceAgentTools(
      duplicate.id,
      toolRows.map(({ tool }) => tool.id),
    );
    return reply.code(201).send(await agentPayload(repository, duplicate));
  });
  app.delete("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await repository.deleteAgent(id);
    runtime.invalidateAgent(id);
    return reply.code(204).send();
  });

  app.get("/api/a2a/exposures", async () => {
    const exposures = await repository.listA2aExposures();
    return Promise.all(
      exposures.map(async (exposure) =>
        a2aExposurePayload(exposure, await repository.getAgent(exposure.agentId)),
      ),
    );
  });
  app.post("/api/a2a/exposures", async (request, reply) => {
    const input = createA2aExposureSchema.parse(request.body);
    const agent = await repository.getAgent(input.agentId);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    if (await repository.getA2aExposureByAgentId(input.agentId)) {
      return reply.code(409).send({ error: "This agent already has an A2A exposure" });
    }
    if (await repository.getA2aExposureBySlug(input.slug)) {
      return reply.code(409).send({ error: "This A2A exposure slug is already in use" });
    }
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      agentId: input.agentId,
      slug: input.slug,
      published: input.published,
      enabled: input.enabled,
      visibility: input.visibility,
      authMode: input.authMode,
      authEnv: input.authEnv || null,
      streaming: input.streaming,
      maxTaskSeconds: input.maxTaskSeconds,
      maxRequestsPerMinute: input.maxRequestsPerMinute,
      maxConcurrentTasks: input.maxConcurrentTasks,
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertA2aExposure(row);
    await repository.insertA2aAuditEvent({
      id: randomUUID(),
      exposureId: row.id,
      taskId: null,
      actorType: "ui-admin",
      action: "exposure.created",
      callerHash: null,
      metadataJson: JSON.stringify({ username: currentSession(request)?.username ?? "unknown", slug: row.slug, published: row.published, enabled: row.enabled }),
      createdAt: now,
    });
    return reply.code(201).send(a2aExposurePayload(row, agent));
  });
  app.put("/api/a2a/exposures/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await repository.getA2aExposure(id);
    if (!current) return reply.code(404).send({ error: "A2A exposure not found" });
    const patch = updateA2aExposureSchema.parse(request.body);
    const merged = createA2aExposureSchema.parse({
      agentId: current.agentId,
      slug: patch.slug ?? current.slug,
      published: patch.published ?? current.published,
      enabled: patch.enabled ?? current.enabled,
      visibility: patch.visibility ?? current.visibility,
      authMode: patch.authMode ?? current.authMode,
      authEnv: patch.authEnv === undefined ? current.authEnv ?? undefined : patch.authEnv,
      streaming: patch.streaming ?? current.streaming,
      maxTaskSeconds: patch.maxTaskSeconds ?? current.maxTaskSeconds,
      maxRequestsPerMinute: patch.maxRequestsPerMinute ?? current.maxRequestsPerMinute,
      maxConcurrentTasks: patch.maxConcurrentTasks ?? current.maxConcurrentTasks,
    });
    const slugOwner = await repository.getA2aExposureBySlug(merged.slug);
    if (slugOwner && slugOwner.id !== id) {
      return reply.code(409).send({ error: "This A2A exposure slug is already in use" });
    }
    await repository.updateA2aExposure(id, {
      slug: merged.slug,
      published: merged.published,
      enabled: merged.enabled,
      visibility: merged.visibility,
      authMode: merged.authMode,
      authEnv: merged.authEnv || null,
      streaming: merged.streaming,
      maxTaskSeconds: merged.maxTaskSeconds,
      maxRequestsPerMinute: merged.maxRequestsPerMinute,
      maxConcurrentTasks: merged.maxConcurrentTasks,
      updatedAt: new Date().toISOString(),
    });
    await repository.insertA2aAuditEvent({
      id: randomUUID(),
      exposureId: id,
      taskId: null,
      actorType: "ui-admin",
      action: "exposure.updated",
      callerHash: null,
      metadataJson: JSON.stringify({ username: currentSession(request)?.username ?? "unknown", slug: merged.slug, published: merged.published, enabled: merged.enabled }),
      createdAt: new Date().toISOString(),
    });
    return a2aExposurePayload(
      await repository.getA2aExposure(id),
      await repository.getAgent(current.agentId),
    );
  });
  app.delete("/api/a2a/exposures/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await repository.getA2aExposure(id))) {
      return reply.code(404).send({ error: "A2A exposure not found" });
    }
    await repository.insertA2aAuditEvent({
      id: randomUUID(),
      exposureId: id,
      taskId: null,
      actorType: "ui-admin",
      action: "exposure.deleted",
      callerHash: null,
      metadataJson: JSON.stringify({ username: currentSession(request)?.username ?? "unknown" }),
      createdAt: new Date().toISOString(),
    });
    await repository.deleteA2aExposure(id);
    return reply.code(204).send();
  });

  const a2aError = (code: string, message: string, data?: unknown) => ({
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
  const a2aVersion = (request: { headers: Record<string, string | string[] | undefined> }, reply: FastifyReply): boolean => {
    const version = request.headers["a2a-version"];
    if (version === "1.0") {
      reply.header("A2A-Version", "1.0");
      return true;
    }
    reply.code(400).type("application/a2a+json").send(a2aError("VersionNotSupportedError", "A2A-Version: 1.0 is required"));
    return false;
  };
  const a2aExposure = async (slug: string, reply: FastifyReply) => {
    const exposure = await repository.getA2aExposureBySlug(slug);
    const agent = exposure ? await repository.getAgent(exposure.agentId) : undefined;
    if (!exposure || !exposure.published || !exposure.enabled || !agent?.enabled) {
      reply.code(404).type("application/a2a+json").send(a2aError("AgentNotFoundError", "The requested agent is not available"));
      return undefined;
    }
    return { exposure, agent };
  };
  const a2aCaller = async (
    request: { headers: Record<string, string | string[] | undefined>; ip?: string },
    reply: FastifyReply,
    exposure: { id: string; authMode: string; authEnv: string | null; visibility: string },
    card = false,
  ): Promise<string | undefined> => {
    const address = request.ip ?? "unknown";
    if (card && exposure.visibility === "public") return callerFingerprint(`card:${address}`);
    if (exposure.authMode === "none") {
      if (exposure.visibility !== "public") {
        await repository.insertA2aAuditEvent({ id: randomUUID(), exposureId: exposure.id, taskId: null, actorType: "a2a-caller", action: "auth.denied", callerHash: callerFingerprint(`anonymous:${address}`), metadataJson: "{}", createdAt: new Date().toISOString() });
        reply.code(401).type("application/a2a+json").send(a2aError("Unauthenticated", "This agent requires authentication"));
        return undefined;
      }
      return callerFingerprint(`anonymous:${address}`);
    }
    const configured = exposure.authEnv ? process.env[exposure.authEnv] : undefined;
    if (!configured) {
      await repository.insertA2aAuditEvent({ id: randomUUID(), exposureId: exposure.id, taskId: null, actorType: "system", action: "auth.misconfigured", callerHash: null, metadataJson: "{}", createdAt: new Date().toISOString() });
      reply.code(503).type("application/a2a+json").send(a2aError("ServiceNotReady", "The configured A2A credential is not available"));
      return undefined;
    }
    const header = request.headers.authorization;
    const raw = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header)?.[1] : undefined;
    const left = Buffer.from(configured);
    const right = Buffer.from(raw ?? "");
    if (!raw || left.length !== right.length || !timingSafeEqual(left, right)) {
      await repository.insertA2aAuditEvent({ id: randomUUID(), exposureId: exposure.id, taskId: null, actorType: "a2a-caller", action: "auth.denied", callerHash: callerFingerprint(`bearer:${raw ?? "missing"}`), metadataJson: "{}", createdAt: new Date().toISOString() });
      reply.header("WWW-Authenticate", "Bearer");
      reply.code(401).type("application/a2a+json").send(a2aError("Unauthenticated", "A valid bearer credential is required"));
      return undefined;
    }
    return callerFingerprint(`bearer:${raw}`);
  };
  const a2aRateLimit = async (exposure: { id: string; maxRequestsPerMinute: number }, callerHash: string, reply: FastifyReply): Promise<boolean> => {
    const now = Date.now();
    const key = `${exposure.id}:${callerHash}`;
    const recent = (a2aRateBuckets.get(key) ?? []).filter((timestamp) => timestamp > now - 60_000);
    if (recent.length >= exposure.maxRequestsPerMinute) {
      a2aRateBuckets.set(key, recent);
      await repository.insertA2aAuditEvent({ id: randomUUID(), exposureId: exposure.id, taskId: null, actorType: "a2a-caller", action: "request.rate_limited", callerHash, metadataJson: "{}", createdAt: new Date().toISOString() });
      reply.header("Retry-After", "60");
      reply.code(429).type("application/a2a+json").send(a2aError("RateLimitExceeded", "The exposure request limit has been reached"));
      return false;
    }
    recent.push(now);
    a2aRateBuckets.set(key, recent);
    return true;
  };
  const a2aJson = (reply: FastifyReply, payload: unknown, status = 200) => reply.code(status).type("application/a2a+json").send(payload);
  const a2aPublicBase = (request: { protocol: string; headers: { host?: string } }) =>
    (process.env.OAC_A2A_PUBLIC_BASE_URL?.trim() || `${request.protocol}://${request.headers.host ?? "127.0.0.1:3000"}`).replace(/\/$/, "");

  app.get("/a2a/:slug/.well-known/agent-card.json", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const state = await a2aExposure(slug, reply);
    if (!state) return;
    const caller = await a2aCaller(request, reply, state.exposure, true);
    if (!caller) return;
    const skills = (await repository.listAgentSkills(state.agent.id)).filter(({ skill }) => skill.enabled).map(({ skill }) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description ?? "",
      tags: skill.name.toLowerCase().split(/\s+/).slice(0, 5),
      examples: [],
    }));
    const card = {
      name: state.agent.name,
      description: state.agent.description ?? "",
      version: appVersion,
      supportedInterfaces: [{ url: `${a2aPublicBase(request)}/a2a/${state.exposure.slug}`, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
      capabilities: { streaming: state.exposure.streaming, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills,
      ...(state.exposure.authMode === "bearer" ? {
        securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer", bearerFormat: "Bearer" } } },
        securityRequirements: [{ bearer: [] }],
      } : {}),
    };
    return a2aJson(reply, card);
  });

  const submitA2a = async (request: { headers: Record<string, string | string[] | undefined>; ip?: string; id: string; params: unknown; body: unknown }, reply: FastifyReply) => {
    const { slug } = request.params as { slug: string };
    const state = await a2aExposure(slug, reply);
    if (!state || !a2aVersion(request, reply)) return undefined;
    const caller = await a2aCaller(request, reply, state.exposure);
    if (!caller || !(await a2aRateLimit(state.exposure, caller, reply))) return undefined;
    const input = a2aSendMessageSchema.parse(request.body);
    return a2aTasks.submit(state.exposure, input.message, caller, request.id);
  };
  app.post("/a2a/:slug/message*", async (request, reply) => {
    const operation = request.url.split("/message:", 2)[1]?.split("?", 1)[0];
    if (operation !== "send" && operation !== "stream") return a2aJson(reply, a2aError("UnsupportedOperationError", "Unsupported message operation"), 404);
    if (operation === "send") {
      const task = await submitA2a(request, reply);
      return task ? a2aJson(reply, task) : undefined;
    }
    const { slug } = request.params as { slug: string };
    const state = await a2aExposure(slug, reply);
    if (!state || !a2aVersion(request, reply)) return;
    if (!state.exposure.streaming) return a2aJson(reply, a2aError("UnsupportedOperationError", "Streaming is disabled for this exposure"), 501);
    const caller = await a2aCaller(request, reply, state.exposure);
    if (!caller || !(await a2aRateLimit(state.exposure, caller, reply))) return;
    const input = a2aSendMessageSchema.parse(request.body);
    const task = await a2aTasks.submit(state.exposure, input.message, caller, request.id);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "A2A-Version": "1.0" });
    try {
      for await (const event of a2aTasks.subscribe(state.exposure.id, task.id, caller)) {
        const name = event.type === "status" ? "status-update" : "artifact-update";
        reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(event.type === "status" ? { taskId: event.task.id, contextId: event.task.contextId, status: event.task.status, final: event.final } : event)}\n\n`);
      }
    } finally {
      reply.raw.end();
    }
  });
  app.get("/a2a/:slug/tasks", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const state = await a2aExposure(slug, reply);
    if (!state || !a2aVersion(request, reply)) return;
    const caller = await a2aCaller(request, reply, state.exposure);
    if (!caller || !(await a2aRateLimit(state.exposure, caller, reply))) return;
    const query = a2aTaskQuerySchema.parse(request.query);
    const offset = query.pageToken ? Number.parseInt(query.pageToken, 10) || 0 : 0;
    return a2aJson(reply, await a2aTasks.list(state.exposure.id, caller, query.contextId, query.pageSize, offset));
  });
  app.get("/a2a/:slug/tasks/:id", async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const state = await a2aExposure(slug, reply);
    if (!state || !a2aVersion(request, reply)) return;
    const caller = await a2aCaller(request, reply, state.exposure);
    if (!caller || !(await a2aRateLimit(state.exposure, caller, reply))) return;
    return a2aJson(reply, await a2aTasks.get(state.exposure.id, id, caller));
  });
  app.post("/a2a/:slug/tasks/:id*", async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string };
    const operation = request.url.split(`${id}:`, 2)[1]?.split("?", 1)[0];
    if (operation !== "cancel" && operation !== "subscribe") return a2aJson(reply, a2aError("UnsupportedOperationError", "Unsupported task operation"), 404);
    const state = await a2aExposure(slug, reply);
    if (!state || !a2aVersion(request, reply)) return;
    const caller = await a2aCaller(request, reply, state.exposure);
    if (!caller || !(await a2aRateLimit(state.exposure, caller, reply))) return;
    if (operation === "cancel") return a2aJson(reply, await a2aTasks.cancel(state.exposure.id, id, caller));
    if (!state.exposure.streaming) return a2aJson(reply, a2aError("UnsupportedOperationError", "Streaming is disabled for this exposure"), 501);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "A2A-Version": "1.0" });
    try {
      for await (const event of a2aTasks.subscribe(state.exposure.id, id, caller)) {
        const name = event.type === "status" ? "status-update" : "artifact-update";
        reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(event.type === "status" ? { taskId: event.task.id, contextId: event.task.contextId, status: event.task.status, final: event.final } : event)}\n\n`);
      }
    } finally {
      reply.raw.end();
    }
  });

  async function agentMemory(agentId: string, reply: FastifyReply) {
    const agent = await repository.getAgent(agentId);
    if (!agent) {
      reply.code(404).send({ error: "Agent not found" });
      return undefined;
    }
    const connector = agent.memoryConnectorId
      ? await repository.getMemoryConnector(agent.memoryConnectorId)
      : undefined;
    if (!connector || !connector.enabled || connector.type !== "sqlite") {
      reply
        .code(409)
        .send({
          error: "Agent must select an enabled SQLite memory connector",
        });
      return undefined;
    }
    return { agent, connector };
  }
  app.get("/api/agents/:id/memories", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await repository.getAgent(id);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const connector = agent.memoryConnectorId
      ? await repository.getMemoryConnector(agent.memoryConnectorId)
      : undefined;
    return {
      connector: connector ? memoryConnectorPayload(connector) : null,
      items:
        connector?.type === "sqlite"
          ? (await repository.listMemories(id, connector.id)).map(memoryPayload)
          : [],
    };
  });
  app.post("/api/agents/:id/memories", async (request, reply) => {
    const { id } = request.params as { id: string };
    const state = await agentMemory(id, reply);
    if (!state) return;
    const input = memorySchema.parse(request.body);
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      agentId: id,
      connectorId: state.connector.id,
      key: input.key ?? null,
      content: input.content,
      metadataJson: JSON.stringify(input.metadata),
      createdAt: now,
      updatedAt: now,
    };
    await repository.insertMemory(row);
    runtime.invalidateAgent(id);
    return reply.code(201).send(memoryPayload(row));
  });
  app.put("/api/agents/:agentId/memories/:memoryId", async (request, reply) => {
    const { agentId, memoryId } = request.params as {
      agentId: string;
      memoryId: string;
    };
    const state = await agentMemory(agentId, reply);
    if (!state) return;
    const current = await repository.getMemory(memoryId);
    if (!current || current.agentId !== agentId)
      return reply.code(404).send({ error: "Memory not found" });
    const input = updateMemorySchema.parse(request.body);
    await repository.updateMemory(memoryId, {
      key: input.key === undefined ? current.key : (input.key ?? null),
      content: input.content ?? current.content,
      metadataJson: input.metadata
        ? JSON.stringify(input.metadata)
        : current.metadataJson,
      updatedAt: new Date().toISOString(),
    });
    runtime.invalidateAgent(agentId);
    return memoryPayload(await repository.getMemory(memoryId));
  });
  app.delete(
    "/api/agents/:agentId/memories/:memoryId",
    async (request, reply) => {
      const { agentId, memoryId } = request.params as {
        agentId: string;
        memoryId: string;
      };
      const current = await repository.getMemory(memoryId);
      if (!current || current.agentId !== agentId)
        return reply.code(404).send({ error: "Memory not found" });
      await repository.deleteMemory(memoryId);
      runtime.invalidateAgent(agentId);
      return reply.code(204).send();
    },
  );

  app.get("/api/registry/export", async () => {
    const [modelRows, agentRows, skillRows, toolRows, mcpRows, connectorRows] =
      await Promise.all([
        repository.listModels(),
        repository.listAgents(),
        repository.listSkills(),
        repository.listTools(),
        repository.listMcpServers(),
        repository.listMemoryConnectors(),
      ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      models: modelRows.map((row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        modelId: row.modelId,
        baseUrl: row.baseUrl ?? "",
        apiKeyEnv: row.apiKeyEnv,
        enabled: row.enabled,
        temperature: row.temperature ?? undefined,
        maxTokens: row.maxTokens ?? undefined,
        capabilities: capabilities(row.capabilitiesJson),
        timeoutMs: row.timeoutMs,
        maxRetries: row.maxRetries,
      })),
      skills: skillRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        instructions: row.instructions,
        enabled: row.enabled,
      })),
      tools: toolRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        config: safeToolConfig(parseJson(row.configJson)),
        inputSchema: parseJson(row.inputSchemaJson),
        mcpServerId: row.mcpServerId,
        externalName: row.externalName ?? undefined,
        enabled: row.enabled,
      })),
      mcpServers: mcpRows.map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        headers: redactHeaders(parseJson(row.headersJson)),
        enabled: row.enabled,
      })),
      memoryConnectors: connectorRows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        config: {},
        enabled: row.enabled,
      })),
      agents: await Promise.all(
        agentRows.map(async (row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? undefined,
          modelRef: row.modelRef,
          memoryConnectorId: row.memoryConnectorId,
          accessLevel: normalizedAgentAccess(row.accessLevel),
          instructions: row.instructions,
          enabled: row.enabled,
          temperature: row.temperature ?? undefined,
          maxTokens: row.maxTokens ?? undefined,
          maxModelCalls: row.maxModelCalls,
          maxToolCalls: row.maxToolCalls,
          skillIds: (await repository.listAgentSkills(row.id)).map(
            ({ skill }) => skill.id,
          ),
          toolIds: (await repository.listAgentTools(row.id)).map(
            ({ tool }) => tool.id,
          ),
        })),
      ),
      omitted: [
        "API keys, raw MCP/HTTP header values, other secret values and long-term memories",
      ],
    };
  });
  app.post("/api/registry/import", async (request, reply) => {
    const input = registryImportSchema.parse(request.body);
    const modelIds = new Map<string, string>();
    const skillIds = new Map<string, string>();
    const toolIds = new Map<string, string>();
    const mcpIds = new Map<string, string>();
    const connectorIds = new Map<string, string>();
    const idOf = (sourceId: string | undefined, map: Map<string, string>) => {
      const id = sourceId ?? randomUUID();
      if (sourceId) map.set(sourceId, id);
      return id;
    };
    for (const model of input.models) {
      model.id ??= randomUUID();
      idOf(model.id, modelIds);
    }
    for (const skill of input.skills) {
      skill.id ??= randomUUID();
      idOf(skill.id, skillIds);
    }
    for (const tool of input.tools) {
      tool.id ??= randomUUID();
      idOf(tool.id, toolIds);
    }
    for (const server of input.mcpServers) {
      server.id ??= randomUUID();
      idOf(server.id, mcpIds);
    }
    for (const connector of input.memoryConnectors) {
      connector.id ??= randomUUID();
      idOf(connector.id, connectorIds);
    }
    for (const agent of input.agents) agent.id ??= randomUUID();
    try {
      const imported = await withSqliteTransaction(sqliteConnection, async () => {
        let created = 0;
        let updated = 0;
        for (const model of input.models) {
      const id = idOf(model.id, modelIds);
      const now = new Date().toISOString();
      const row = {
        id,
        name: model.name,
        provider: model.provider,
        modelId: model.modelId,
        baseUrl: model.baseUrl || null,
        apiKeyEnv: model.apiKeyEnv,
        enabled: model.enabled ?? true,
        temperature: model.temperature ?? null,
        maxTokens: model.maxTokens ?? null,
        capabilitiesJson: JSON.stringify(model.capabilities),
        timeoutMs: model.timeoutMs,
        maxRetries: model.maxRetries,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getModel(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateModel(id, row);
        updated += 1;
      } else {
        await repository.insertModel(row);
        created += 1;
      }
        }
        for (const connector of input.memoryConnectors) {
      const id = idOf(connector.id, connectorIds);
      const now = new Date().toISOString();
      const row = {
        id,
        name: connector.name,
        type: connector.type,
        configJson: JSON.stringify(connector.config),
        enabled: connector.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getMemoryConnector(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateMemoryConnector(id, row);
        updated += 1;
      } else {
        await repository.insertMemoryConnector(row);
        created += 1;
      }
        }
        for (const skill of input.skills) {
      const id = idOf(skill.id, skillIds);
      const now = new Date().toISOString();
      const row = {
        id,
        name: skill.name,
        description: skill.description ?? null,
        instructions: skill.instructions,
        enabled: skill.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getSkill(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateSkill(id, row);
        updated += 1;
      } else {
        await repository.insertSkill(row);
        created += 1;
      }
        }
        for (const server of input.mcpServers) {
      const id = idOf(server.id, mcpIds);
      const now = new Date().toISOString();
      const row = {
        id,
        name: server.name,
        url: server.url,
        headersJson: JSON.stringify(server.headers),
        enabled: server.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getMcpServer(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateMcpServer(id, row);
        updated += 1;
      } else {
        await repository.insertMcpServer(row);
        created += 1;
      }
        }
        for (const tool of input.tools) {
      const id = idOf(tool.id, toolIds);
      const normalized = {
        ...tool,
        mcpServerId: tool.mcpServerId
          ? (mcpIds.get(tool.mcpServerId) ?? tool.mcpServerId)
          : undefined,
      };
      await validateTool(normalized);
      const now = new Date().toISOString();
      const row = {
        id,
        name: tool.name,
        description: tool.description,
        kind: tool.kind,
        configJson: JSON.stringify(safeToolConfig(tool.config)),
        inputSchemaJson: JSON.stringify(tool.inputSchema),
        mcpServerId: normalized.mcpServerId ?? null,
        externalName: tool.externalName ?? null,
        enabled: tool.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getTool(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateTool(id, row);
        updated += 1;
      } else {
        await repository.insertTool(row);
        created += 1;
      }
        }
        for (const agent of input.agents) {
      const modelRef = modelIds.get(agent.modelRef) ?? agent.modelRef;
      const memoryConnectorId = agent.memoryConnectorId
        ? (connectorIds.get(agent.memoryConnectorId) ?? agent.memoryConnectorId)
        : null;
      const id = agent.id ?? randomUUID();
      if (!(await repository.getModel(modelRef)))
        throw new Error(
          `Imported agent ${agent.name} references an unknown model`,
        );
      const skillList = agent.skillIds.map(
        (value) => skillIds.get(value) ?? value,
      );
      const toolList = agent.toolIds.map(
        (value) => toolIds.get(value) ?? value,
      );
      await validateAgentReferences(
        repository,
        skillList,
        toolList,
        memoryConnectorId,
      );
      const now = new Date().toISOString();
      const row = {
        id,
        name: agent.name,
        description: agent.description ?? null,
        modelRef,
        memoryConnectorId,
        accessLevel: normalizedAgentAccess(agent.accessLevel),
        instructions: agent.instructions,
        enabled: agent.enabled ?? true,
        temperature: agent.temperature ?? null,
        maxTokens: agent.maxTokens ?? null,
        maxModelCalls: agent.maxModelCalls,
        maxToolCalls: agent.maxToolCalls,
        createdAt: now,
        updatedAt: now,
      };
      const existing = await repository.getAgent(id);
      row.createdAt = existing?.createdAt ?? now;
      if (existing) {
        await repository.updateAgent(id, row);
        updated += 1;
      } else {
        await repository.insertAgent(row);
        created += 1;
      }
      await repository.replaceAgentSkills(id, skillList);
      await repository.replaceAgentTools(id, toolList);
        }
        return { created, updated, skipped: 0 };
      });
      runtime.invalidateAll();
      return reply
        .code(202)
        .send({
          ok: true,
          imported: {
            models: input.models.length,
            skills: input.skills.length,
            tools: input.tools.length,
            mcpServers: input.mcpServers.length,
            memoryConnectors: input.memoryConnectors.length,
            agents: input.agents.length,
            ...imported,
          },
        });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Registry import failed",
        code: "REGISTRY_IMPORT_REJECTED",
        correlationId: request.id,
      });
    }
  });

  app.get("/api/sessions", async (request) => {
    const page = sessionQuerySchema.parse(request.query);
    const visibleIds = await accessibleAgentIds(request);
    if (visibleIds) {
      const rows = await repository.listSessions(0, 10_000, page.agentId);
      const filtered = rows.filter((row) => visibleIds.includes(row.agentId));
      const items = filtered.slice(page.offset, page.offset + page.limit);
      return {
        items,
        total: filtered.length,
        hasMore: page.offset + items.length < filtered.length,
        ...page,
      };
    }
    const [items, total] = await Promise.all([
      repository.listSessions(page.offset, page.limit, page.agentId),
      repository.countSessions(page.agentId),
    ]);
    return {
      items,
      total,
      hasMore: page.offset + items.length < total,
      ...page,
    };
  });
  app.patch("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await accessibleSession(request, id)))
      return reply.code(404).send({ error: "Session not found" });
    const input = updateSessionSchema.parse(request.body);
    await repository.updateSession(id, {
      title: input.title,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  });
  app.delete("/api/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await accessibleSession(request, id)))
      return reply.code(404).send({ error: "Session not found" });
    await repository.deleteSession(id);
    return reply.code(204).send();
  });
  app.get("/api/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await accessibleSession(request, id)))
      return reply.code(404).send({ error: "Session not found" });
    return repository.listMessages(id);
  });
  app.get("/api/runs", async (request) => {
    const page = runQuerySchema.parse(request.query);
    const filters = {
      agentId: page.agentId,
      sessionId: page.sessionId,
      status: page.status,
    };
    const visibleIds = await accessibleAgentIds(request);
    if (visibleIds) {
      const rows = await repository.listRuns(0, 10_000, filters);
      const filtered = rows.filter((row) => visibleIds.includes(row.agentId));
      const items = filtered.slice(page.offset, page.offset + page.limit);
      return {
        items,
        total: filtered.length,
        hasMore: page.offset + items.length < filtered.length,
        ...page,
      };
    }
    const [items, total] = await Promise.all([
      repository.listRuns(page.offset, page.limit, filters),
      repository.countRuns(filters),
    ]);
    return {
      items,
      total,
      hasMore: page.offset + items.length < total,
      ...page,
    };
  });
  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await repository.getRun(id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return {
      ...run,
      durationMs: run.completedAt
        ? Math.max(0, Date.parse(run.completedAt) - Date.parse(run.startedAt))
        : null,
      toolCalls: await repository.listToolCalls(id),
    };
  });
  app.post("/api/agents/:id/chat", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = chatRequestSchema.parse(request.body);
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Correlation-ID": request.id,
    });
    try {
      for await (const event of runtime.stream(
        id,
        input.sessionId,
        input.message,
        {
          signal: controller.signal,
          correlationId: request.id,
          attachments: input.attachments ?? [],
        },
      ))
        reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent execution failed";
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ version: 1, type: "error", message, code: "AGENT_EXECUTION_FAILED", correlationId: request.id })}\n\n`,
      );
    } finally {
      reply.raw.end();
    }
  });
  const webRoot = path.resolve(process.cwd(), "dist/web");
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
