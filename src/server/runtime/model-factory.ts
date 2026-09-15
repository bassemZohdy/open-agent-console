import { ChatOpenAI } from '@langchain/openai';
import type { InferSelectModel } from 'drizzle-orm';
import type { models } from '../db/schema.js';

type ModelRecord = InferSelectModel<typeof models>;

export function createChatModel(model: ModelRecord, overrides?: { temperature?: number | null; maxTokens?: number | null }) {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Credential environment variable ${model.apiKeyEnv} is not configured`);
  }

  return new ChatOpenAI({
    model: model.modelId,
    apiKey,
    temperature: overrides?.temperature ?? model.temperature ?? undefined,
    maxTokens: overrides?.maxTokens ?? model.maxTokens ?? undefined,
    timeout: 60_000,
    maxRetries: 2,
    streamUsage: false,
    configuration: model.baseUrl ? { baseURL: model.baseUrl } : undefined,
  });
}
