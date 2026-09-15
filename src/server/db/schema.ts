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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  modelRef: text('model_ref').notNull().references(() => models.id, { onDelete: 'restrict' }),
  instructions: text('instructions').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  temperature: real('temperature'),
  maxTokens: integer('max_tokens'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
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
});
