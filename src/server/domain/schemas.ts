import { z } from 'zod';

export const providerSchema = z.enum(['openai', 'openai-compatible', 'anthropic', 'google', 'ollama']);
export const capabilitySchema = z.enum(['streaming', 'tools', 'vision', 'audio', 'structured-output']);

const modelBaseSchema = z.object({
  name: z.string().min(1).max(120),
  provider: providerSchema,
  modelId: z.string().min(1).max(200),
  baseUrl: z.string().url().optional().or(z.literal('')),
  apiKeyEnv: z.string().max(120).regex(/^$|^[A-Z][A-Z0-9_]*$/),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  capabilities: z.array(capabilitySchema).min(1).default(['streaming']),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  maxRetries: z.number().int().min(0).max(10).default(2),
});

export const createModelSchema = modelBaseSchema.superRefine((value, ctx) => {
  if (value.provider !== 'ollama' && !value.apiKeyEnv) ctx.addIssue({ code: 'custom', path: ['apiKeyEnv'], message: 'A credential environment variable is required for this provider' });
  if (value.provider === 'openai-compatible' && !value.baseUrl) ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL is required for OpenAI-compatible providers' });
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
export const toolKindSchema = z.enum(['builtin-calculator', 'builtin-datetime', 'http', 'mcp']);
export const toolSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  kind: toolKindSchema,
  config: jsonObjectSchema.default({}),
  inputSchema: jsonObjectSchema.default({ type: 'object', additionalProperties: false }),
  enabled: z.boolean().default(true),
});
export const updateToolSchema = toolSchema.partial();

export const mcpServerSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().refine((url) => url.startsWith('http://') || url.startsWith('https://'), 'MCP URL must use HTTP or HTTPS'),
  headers: z.record(z.string(), z.union([z.string(), z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })])).default({}),
  enabled: z.boolean().default(true),
});
export const updateMcpServerSchema = mcpServerSchema.partial();

export const memoryConnectorSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['none', 'sqlite']),
  config: jsonObjectSchema.default({}),
  enabled: z.boolean().default(true),
});
export const updateMemoryConnectorSchema = memoryConnectorSchema.partial();

export const memorySchema = z.object({
  key: z.string().max(200).optional(),
  content: z.string().min(1).max(20_000),
  metadata: jsonObjectSchema.default({}),
});

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(100_000),
  sessionId: z.string().uuid().optional(),
});

export const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
