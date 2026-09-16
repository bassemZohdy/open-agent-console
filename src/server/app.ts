import { randomUUID } from "node:crypto";
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
  chatRequestSchema,
  createAgentSchema,
  createModelSchema,
  memoryConnectorSchema,
  memorySchema,
  mcpServerSchema,
  paginationSchema,
  registryImportSchema,
  skillSchema,
  toolSchema,
  updateAgentSchema,
  updateMemorySchema,
  updateMemoryConnectorSchema,
  updateMcpServerSchema,
  updateSkillSchema,
  updateToolSchema,
  updateModelSchema,
} from "./domain/schemas.js";
import { AgentRuntimeManager } from "./runtime/agent-runtime-manager.js";
import {
  assertPublicHttpUrl,
  discoverMcpTools,
} from "./runtime/tool-resolver.js";
import { testModelConnection } from "./runtime/model-factory.js";

const ajv = new Ajv({ allErrors: true, strict: false });

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

async function agentPayload(repository: RegistryRepository, row: unknown) {
  if (!row) return row;
  const record = row as Record<string, unknown> & { id: string };
  const [orderedSkills, orderedTools] = await Promise.all([
    repository.listAgentSkills(record.id),
    repository.listAgentTools(record.id),
  ]);
  return {
    ...record,
    skillIds: orderedSkills.map(({ skill }) => skill.id),
    toolIds: orderedTools.map(({ tool }) => tool.id),
  };
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

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  const runtime = new AgentRuntimeManager();
  const repository = new RegistryRepository();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-correlation-id", request.id);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: "Validation failed", details: error.issues });
    if (error instanceof SyntaxError)
      return reply.code(400).send({ error: "Malformed JSON payload" });
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED")
      return reply
        .code(503)
        .send({ error: "Database is temporarily busy; retry the request" });
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY")
      return reply
        .code(409)
        .send({ error: "Operation conflicts with referenced records" });
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (_request, reply) => {
    try {
      sqlite.prepare("SELECT 1").get();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
  app.get("/api/settings", async () => ({
    application: "Open Agent Console",
    version: "0.4.0",
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
      throw new Error("Selected MCP server does not exist");
    try {
      ajv.compile(parsed.inputSchema);
    } catch (error) {
      throw new Error(
        `Invalid input schema: ${error instanceof Error ? error.message : "schema compilation failed"}`,
        { cause: error },
      );
    }
    if (parsed.kind === "http") {
      try {
        new URL(parsed.config.url as string);
      } catch {
        throw new Error("HTTP tool URL is invalid");
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

  app.get("/api/agents", async () =>
    Promise.all(
      (await repository.listAgents()).map((agent) =>
        agentPayload(repository, agent),
      ),
    ),
  );
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
      if (await repository.getModel(id)) await repository.updateModel(id, row);
      else await repository.insertModel(row);
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
      if (await repository.getMemoryConnector(id))
        await repository.updateMemoryConnector(id, row);
      else await repository.insertMemoryConnector(row);
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
      if (await repository.getSkill(id)) await repository.updateSkill(id, row);
      else await repository.insertSkill(row);
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
      if (await repository.getMcpServer(id))
        await repository.updateMcpServer(id, row);
      else await repository.insertMcpServer(row);
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
      if (await repository.getTool(id)) await repository.updateTool(id, row);
      else await repository.insertTool(row);
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
        instructions: agent.instructions,
        enabled: agent.enabled ?? true,
        temperature: agent.temperature ?? null,
        maxTokens: agent.maxTokens ?? null,
        maxModelCalls: agent.maxModelCalls,
        maxToolCalls: agent.maxToolCalls,
        createdAt: now,
        updatedAt: now,
      };
      if (await repository.getAgent(id)) await repository.updateAgent(id, row);
      else await repository.insertAgent(row);
      await repository.replaceAgentSkills(id, skillList);
      await repository.replaceAgentTools(id, toolList);
    }
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
        },
      });
  });

  app.get("/api/sessions", async (request) => {
    const page = paginationSchema.parse(request.query);
    return {
      items: await repository.listSessions(page.offset, page.limit),
      ...page,
    };
  });
  app.get("/api/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await repository.getSession(id)))
      return reply.code(404).send({ error: "Session not found" });
    return repository.listMessages(id);
  });
  app.get("/api/runs", async (request) => {
    const page = paginationSchema.parse(request.query);
    return {
      items: await repository.listRuns(page.offset, page.limit),
      ...page,
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
        { signal: controller.signal, correlationId: request.id },
      ))
        reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Agent execution failed";
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ version: 1, type: "error", message })}\n\n`,
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
