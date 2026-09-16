import { z } from "zod";

export const providerSchema = z.enum([
  "openai",
  "openai-compatible",
  "anthropic",
  "google",
  "ollama",
  "fake",
]);
export const capabilitySchema = z.enum([
  "streaming",
  "tools",
  "vision",
  "audio",
  "structured-output",
]);

const modelBaseSchema = z.object({
  name: z.string().min(1).max(120),
  provider: providerSchema,
  modelId: z.string().min(1).max(200),
  baseUrl: z.string().url().optional().or(z.literal("")),
  apiKeyEnv: z
    .string()
    .max(120)
    .regex(/^$|^[A-Z][A-Z0-9_]*$/),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  capabilities: z.array(capabilitySchema).min(1).default(["streaming"]),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  maxRetries: z.number().int().min(0).max(10).default(2),
});

export const createModelSchema = modelBaseSchema.superRefine((value, ctx) => {
  if (!["ollama", "fake"].includes(value.provider) && !value.apiKeyEnv)
    ctx.addIssue({
      code: "custom",
      path: ["apiKeyEnv"],
      message:
        "A credential environment variable is required for this provider",
    });
  if (value.provider === "openai-compatible" && !value.baseUrl)
    ctx.addIssue({
      code: "custom",
      path: ["baseUrl"],
      message: "Base URL is required for OpenAI-compatible providers",
    });
});
export const updateModelSchema = modelBaseSchema.partial();

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  modelRef: z.string().uuid(),
  memoryConnectorId: z.string().uuid().nullable().optional(),
  instructions: z.string().min(1).max(50_000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  maxModelCalls: z.number().int().min(1).max(50).default(6),
  maxToolCalls: z.number().int().min(1).max(100).default(10),
  skillIds: z.array(z.string().uuid()).max(100).default([]),
  toolIds: z.array(z.string().uuid()).max(100).default([]),
});
export const updateAgentSchema = createAgentSchema.partial();

export const skillSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  instructions: z.string().min(1).max(50_000),
  enabled: z.boolean().default(true),
});
export const updateSkillSchema = skillSchema.partial();

const jsonObjectSchema = z.record(z.string(), z.unknown());
export const toolKindSchema = z.enum([
  "builtin-calculator",
  "builtin-datetime",
  "http",
  "mcp",
]);
const toolBaseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  kind: toolKindSchema,
  config: jsonObjectSchema.default({}),
  inputSchema: jsonObjectSchema.default({
    type: "object",
    additionalProperties: false,
  }),
  mcpServerId: z.string().uuid().nullable().optional(),
  externalName: z.string().min(1).max(200).optional(),
  enabled: z.boolean().default(true),
});
export const toolSchema = toolBaseSchema.superRefine((value, ctx) => {
  if (value.kind === "http") {
    const url = value.config.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
      ctx.addIssue({
        code: "custom",
        path: ["config", "url"],
        message: "HTTP tools require an HTTP or HTTPS URL",
      });
    if (
      value.config.method !== undefined &&
      (typeof value.config.method !== "string" ||
        !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(
          value.config.method.toUpperCase(),
        ))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "method"],
        message: "HTTP method must be GET, POST, PUT, PATCH or DELETE",
      });
    }
  }
  if (value.kind === "mcp") {
    if (!value.mcpServerId)
      ctx.addIssue({
        code: "custom",
        path: ["mcpServerId"],
        message: "MCP tools require an MCP server",
      });
    if (!value.externalName)
      ctx.addIssue({
        code: "custom",
        path: ["externalName"],
        message: "MCP tools require the discovered external name",
      });
  }
  if (value.kind !== "mcp" && (value.mcpServerId || value.externalName))
    ctx.addIssue({
      code: "custom",
      path: ["mcpServerId"],
      message: "Only MCP tools may reference an MCP server",
    });
});
export const updateToolSchema = toolBaseSchema.partial();

export const mcpServerSchema = z.object({
  name: z.string().min(1).max(120),
  url: z
    .string()
    .url()
    .refine(
      (url) => url.startsWith("http://") || url.startsWith("https://"),
      "MCP URL must use HTTP or HTTPS",
    ),
  headers: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
      ]),
    )
    .default({}),
  enabled: z.boolean().default(true),
});
export const updateMcpServerSchema = mcpServerSchema.partial();

export const memoryConnectorSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["none", "sqlite"]),
  config: jsonObjectSchema.default({}),
  enabled: z.boolean().default(true),
});
export const updateMemoryConnectorSchema = memoryConnectorSchema.partial();

export const memorySchema = z.object({
  key: z.string().max(200).optional(),
  content: z.string().min(1).max(20_000),
  metadata: jsonObjectSchema.default({}),
});
export const updateMemorySchema = memorySchema.partial();

export const agentMappingsSchema = z.object({
  skillIds: z.array(z.string().uuid()).max(100).default([]),
  toolIds: z.array(z.string().uuid()).max(100).default([]),
});

const importModelSchema = createModelSchema.extend({
  id: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});
const importSkillSchema = skillSchema.extend({
  id: z.string().uuid().optional(),
});
const importToolSchema = toolSchema.extend({
  id: z.string().uuid().optional(),
});
const importMcpServerSchema = mcpServerSchema.extend({
  id: z.string().uuid().optional(),
});
const importMemoryConnectorSchema = memoryConnectorSchema.extend({
  id: z.string().uuid().optional(),
});
const importAgentSchema = createAgentSchema.extend({
  id: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});

export const registryImportSchema = z.object({
  version: z.literal(1),
  models: z.array(importModelSchema).default([]),
  skills: z.array(importSkillSchema).default([]),
  tools: z.array(importToolSchema).default([]),
  mcpServers: z.array(importMcpServerSchema).default([]),
  memoryConnectors: z.array(importMemoryConnectorSchema).default([]),
  agents: z.array(importAgentSchema).default([]),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(100_000),
  sessionId: z.string().uuid().optional(),
});

export const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
