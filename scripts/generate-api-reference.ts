import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  agentMappingsSchema,
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
  updateMemoryConnectorSchema,
  updateMemorySchema,
  updateMcpServerSchema,
  updateModelSchema,
  updateSessionSchema,
  updateSkillSchema,
  updateToolSchema,
} from "../src/server/domain/schemas.js";

const outputPath = resolve(process.cwd(), "docs/api-reference.json");
const packageVersion = (JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

function schema(value: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(value, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
}

const requestSchemas = {
  CreateModel: createModelSchema,
  UpdateModel: updateModelSchema,
  CreateAgent: createAgentSchema,
  UpdateAgent: updateAgentSchema,
  Skill: skillSchema,
  UpdateSkill: updateSkillSchema,
  Tool: toolSchema,
  UpdateTool: updateToolSchema,
  McpServer: mcpServerSchema,
  UpdateMcpServer: updateMcpServerSchema,
  MemoryConnector: memoryConnectorSchema,
  UpdateMemoryConnector: updateMemoryConnectorSchema,
  Memory: memorySchema,
  UpdateMemory: updateMemorySchema,
  AgentMappings: agentMappingsSchema,
  RegistryImport: registryImportSchema,
  ChatRequest: chatRequestSchema,
  UpdateSession: updateSessionSchema,
  SessionQuery: sessionQuerySchema,
  RunQuery: runQuerySchema,
} as const;

const jsonBody = (name: keyof typeof requestSchemas, required = true) => ({
  ...(required ? { required: true } : {}),
  content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } },
});

const response = (description: string, schemaRef?: string, contentType = "application/json") => ({
  description,
  ...(schemaRef ? { content: { [contentType]: { schema: { $ref: `#/components/schemas/${schemaRef}` } } } } : {}),
});

const paths: Record<string, Record<string, unknown>> = {
  "/api/health": { get: { summary: "Liveness check", responses: { "200": response("Service is healthy") } } },
  "/api/ready": { get: { summary: "Readiness check", responses: { "200": response("Database is ready"), "503": response("Database is unavailable") } } },
  "/api/models": {
    get: { summary: "List models", responses: { "200": response("Models") } },
    post: { summary: "Create a model", requestBody: jsonBody("CreateModel"), responses: { "201": response("Created model") } },
  },
  "/api/agents": {
    get: { summary: "List agents", responses: { "200": response("Agents") } },
    post: { summary: "Create an agent", requestBody: jsonBody("CreateAgent"), responses: { "201": response("Created agent") } },
  },
  "/api/agents/{agentId}/chat": {
    post: {
      summary: "Stream an agent response",
      parameters: [{ name: "agentId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      requestBody: jsonBody("ChatRequest"),
      responses: { "200": response("Server-sent events stream", undefined, "text/event-stream") },
    },
  },
  "/api/agents/{agentId}/mappings": {
    put: {
      summary: "Replace agent skill and tool mappings",
      parameters: [{ name: "agentId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      requestBody: jsonBody("AgentMappings"),
      responses: { "200": response("Updated mappings") },
    },
  },
  "/api/registry/export": { get: { summary: "Export registry configuration", responses: { "200": response("Registry export", "RegistryImport") } } },
  "/api/registry/import": { post: { summary: "Import registry configuration", requestBody: jsonBody("RegistryImport"), responses: { "200": response("Import result") } } },
  "/api/sessions": { get: { summary: "List sessions", parameters: [{ name: "agentId", in: "query", schema: { type: "string", format: "uuid" } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }], responses: { "200": response("Sessions") } } },
  "/api/runs": { get: { summary: "List runs", parameters: [{ name: "agentId", in: "query", schema: { type: "string", format: "uuid" } }, { name: "status", in: "query", schema: { type: "string", enum: ["running", "completed", "failed", "cancelled"] } }], responses: { "200": response("Runs") } } },
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "Open Agent Console API",
    version: packageVersion,
    description: "Checked REST and server-sent event contract for the Open Agent Console control plane.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    schemas: Object.fromEntries(Object.entries(requestSchemas).map(([name, value]) => [name, schema(value)])),
    sse: {
      description: "Chat emits event: session, token, usage, done, cancelled or error. Each data payload is JSON with version 1.",
      contentType: "text/event-stream",
    },
  },
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== serialized) {
    console.error(`API reference is out of date. Run npm run api:generate (${outputPath}).`);
    process.exitCode = 1;
  }
} else {
  mkdirSync(resolve(process.cwd(), "docs"), { recursive: true });
  writeFileSync(outputPath, serialized);
}
