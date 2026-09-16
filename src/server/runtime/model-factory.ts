import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogle } from "@langchain/google";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import type { InferSelectModel } from "drizzle-orm";
import type { models } from "../db/schema.js";

type ModelRecord = InferSelectModel<typeof models>;
type Overrides = { temperature?: number | null; maxTokens?: number | null };

function credential(model: ModelRecord): string {
  const apiKey = process.env[model.apiKeyEnv];
  if (!apiKey)
    throw new Error(
      `Credential environment variable ${model.apiKeyEnv} is not configured`,
    );
  return apiKey;
}

export function createChatModel(model: ModelRecord, overrides?: Overrides) {
  const temperature = overrides?.temperature ?? model.temperature ?? undefined;
  const maxTokens = overrides?.maxTokens ?? model.maxTokens ?? undefined;

  switch (model.provider) {
    case "fake":
      return new FakeListChatModel({
        responses: ["Deterministic fake response"],
      });
    case "openai":
    case "openai-compatible":
      return new ChatOpenAI({
        model: model.modelId,
        apiKey: credential(model),
        temperature,
        maxTokens,
        timeout: model.timeoutMs,
        maxRetries: model.maxRetries,
        streamUsage: true,
        configuration: model.baseUrl ? { baseURL: model.baseUrl } : undefined,
      });
    case "anthropic":
      return new ChatAnthropic({
        model: model.modelId,
        apiKey: credential(model),
        temperature,
        maxTokens,
        maxRetries: model.maxRetries,
      });
    case "google":
      return new ChatGoogle(model.modelId, {
        apiKey: credential(model),
        temperature,
        maxOutputTokens: maxTokens,
        maxRetries: model.maxRetries,
        streamUsage: true,
      });
    case "ollama":
      return new ChatOllama({
        model: model.modelId,
        baseUrl: model.baseUrl || undefined,
        temperature,
        numPredict: maxTokens,
        maxRetries: model.maxRetries,
      });
    default:
      throw new Error(`Unsupported model provider: ${model.provider}`);
  }
}

export async function testModelConnection(
  model: ModelRecord,
): Promise<{ latencyMs: number }> {
  const started = Date.now();
  const chatModel = createChatModel(model, {
    maxTokens: Math.min(model.maxTokens ?? 16, 16),
    temperature: 0,
  });
  await chatModel.invoke("Reply with exactly OK.", {
    timeout: model.timeoutMs,
  });
  return { latencyMs: Date.now() - started };
}
