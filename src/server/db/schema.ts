import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const models = sqliteTable('models', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  baseUrl: text('base_url'),
  apiKeyEnv: text('api_key_env').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  capabilitiesJson: text('capabilities_json').notNull().default('["streaming"]'),
  timeoutMs: integer('timeout_ms').notNull().default(60_000),
  maxRetries: integer('max_retries').notNull().default(2),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const memoryConnectors = sqliteTable('memory_connectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  configJson: text('config_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  modelRef: text('model_ref').notNull().references(() => models.id, { onDelete: 'restrict' }),
  memoryConnectorId: text('memory_connector_id').references(() => memoryConnectors.id, { onDelete: 'set null' }),
  accessLevel: text('access_level').notNull().default('user'),
  instructions: text('instructions').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  maxModelCalls: integer('max_model_calls').notNull().default(6),
  maxToolCalls: integer('max_tool_calls').notNull().default(10),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const a2aExposures = sqliteTable('a2a_exposures', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().unique().references(() => agents.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  visibility: text('visibility').notNull().default('private'),
  authMode: text('auth_mode').notNull().default('bearer'),
  authEnv: text('auth_env'),
  streaming: integer('streaming', { mode: 'boolean' }).notNull().default(true),
  maxTaskSeconds: integer('max_task_seconds').notNull().default(300),
  maxRequestsPerMinute: integer('max_requests_per_minute').notNull().default(60),
  maxConcurrentTasks: integer('max_concurrent_tasks').notNull().default(4),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const a2aTasks = sqliteTable('a2a_tasks', {
  id: text('id').primaryKey(),
  exposureId: text('exposure_id').notNull().references(() => a2aExposures.id, { onDelete: 'cascade' }),
  contextId: text('context_id').notNull(),
  parentTaskId: text('parent_task_id'),
  clientMessageId: text('client_message_id').notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
  state: text('state').notNull().default('TASK_STATE_SUBMITTED'),
  inputJson: text('input_json').notNull(),
  outputText: text('output_text'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  callerHash: text('caller_hash').notNull(),
  correlationId: text('correlation_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
});

export const a2aAuditEvents = sqliteTable('a2a_audit_events', {
  id: text('id').primaryKey(),
  exposureId: text('exposure_id').references(() => a2aExposures.id, { onDelete: 'set null' }),
  taskId: text('task_id').references(() => a2aTasks.id, { onDelete: 'set null' }),
  actorType: text('actor_type').notNull(),
  action: text('action').notNull(),
  callerHash: text('caller_hash'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  instructions: text('instructions').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  headersJson: text('headers_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tools = sqliteTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  kind: text('kind').notNull(),
  configJson: text('config_json').notNull().default('{}'),
  inputSchemaJson: text('input_schema_json').notNull().default('{"type":"object","additionalProperties":false}'),
  mcpServerId: text('mcp_server_id').references(() => mcpServers.id, { onDelete: 'cascade' }),
  externalName: text('external_name'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agentSkills = sqliteTable('agent_skills', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
});

export const agentTools = sqliteTable('agent_tools', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  toolId: text('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  attachmentsJson: text('attachments_json').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  error: text('error'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  correlationId: text('correlation_id'),
  contextTruncated: integer('context_truncated', { mode: 'boolean' }).notNull().default(false),
});

export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  toolId: text('tool_id').references(() => tools.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull(),
  inputJson: text('input_json').notNull().default('{}'),
  output: text('output'),
  error: text('error'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  connectorId: text('connector_id').notNull().references(() => memoryConnectors.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  key: text('key'),
  content: text('content').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
