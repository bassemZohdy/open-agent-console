import { randomUUID } from "node:crypto";
import { fetch as undiciFetch } from "undici";
import type { models } from "../db/schema.js";
import { RegistryRepository } from "../db/repository.js";

type ModelProvider = "openai" | "openai-compatible" | "anthropic" | "google";
type ModelInsert = typeof models.$inferInsert;
type Environment = NodeJS.ProcessEnv;
type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>;

type ProviderConfig = {
  provider: ModelProvider;
  name: string;
  apiKeyEnv: string;
  discoveryUrl: string;
  baseUrl: string | null;
  headers: Record<string, string>;
  mapModels: (payload: unknown) => DiscoveredModel[];
};

type DiscoveredModel = {
  modelId: string;
  displayName?: string;
};

export type ProviderSyncLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type ProviderSyncOptions = {
  env?: Environment;
  fetchImpl?: typeof undiciFetch;
  logger?: ProviderSyncLogger;
  timeoutMs?: number;
  maxModelsPerProvider?: number;
};

export type ProviderSyncSummary = {
  providersConfigured: number;
  providersConnected: number;
  providersFailed: number;
  modelsDiscovered: number;
  modelsRegistered: number;
};

const defaultLogger: ProviderSyncLogger = {
  info: () => undefined,
  warn: () => undefined,
};

function configuredString(env: Environment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function clamp(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value as number), minimum), maximum);
}

function modelId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { id?: unknown }).id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function displayName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { display_name?: unknown; displayName?: unknown }).display_name ??
    (value as { displayName?: unknown }).displayName;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function openAiModels(payload: unknown): DiscoveredModel[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data))
    throw new Error("model list response did not contain a data array");
  return (payload as { data: unknown[] }).data.flatMap((entry) => {
    const id = modelId(entry);
    return id ? [{ modelId: id, displayName: displayName(entry) }] : [];
  });
}

function anthropicModels(payload: unknown): DiscoveredModel[] {
  return openAiModels(payload);
}

function googleModels(payload: unknown): DiscoveredModel[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { models?: unknown }).models))
    throw new Error("Google model list response did not contain a models array");
  return (payload as { models: unknown[] }).models.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const rawName = (entry as { name?: unknown }).name;
    if (typeof rawName !== "string" || !rawName.trim()) return [];
    const modelId = rawName.replace(/^models\//, "").trim();
    if (!modelId) return [];
    const methods = (entry as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes("generateContent")) return [];
    return [{ modelId, displayName: displayName(entry) }];
  });
}

function providerConfigs(env: Environment): ProviderConfig[] {
  const configs: ProviderConfig[] = [];
  const openAiKey = configuredString(env, "OPENAI_API_KEY");
  if (openAiKey) {
    configs.push({
      provider: "openai",
      name: "OpenAI",
      apiKeyEnv: "OPENAI_API_KEY",
      discoveryUrl: "https://api.openai.com/v1/models",
      baseUrl: null,
      headers: { Authorization: `Bearer ${openAiKey}` },
      mapModels: openAiModels,
    });
  }

  const openRouterKey = configuredString(env, "OPENROUTER_API_KEY");
  if (openRouterKey) {
    const baseUrl = configuredString(env, "OAC_OPENROUTER_BASE_URL") ??
      "https://openrouter.ai/api/v1";
    configs.push({
      provider: "openai-compatible",
      name: "OpenRouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
      discoveryUrl: `${baseUrl.replace(/\/$/, "")}/models`,
      baseUrl,
      headers: { Authorization: `Bearer ${openRouterKey}` },
      mapModels: openAiModels,
    });
  }

  const anthropicKey = configuredString(env, "ANTHROPIC_API_KEY");
  if (anthropicKey) {
    configs.push({
      provider: "anthropic",
      name: "Anthropic",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      discoveryUrl: "https://api.anthropic.com/v1/models",
      baseUrl: null,
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      mapModels: anthropicModels,
    });
  }

  const googleKeyEnv = configuredString(env, "GOOGLE_API_KEY")
    ? "GOOGLE_API_KEY"
    : configuredString(env, "GEMINI_API_KEY")
      ? "GEMINI_API_KEY"
      : undefined;
  const googleKey = googleKeyEnv ? configuredString(env, googleKeyEnv) : undefined;
  if (googleKey && googleKeyEnv) {
    configs.push({
      provider: "google",
      name: "Google Gemini",
      apiKeyEnv: googleKeyEnv,
      discoveryUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      baseUrl: null,
      headers: { "x-goog-api-key": googleKey },
      mapModels: googleModels,
    });
  }

  const compatibleKey = configuredString(env, "OAC_OPENAI_COMPATIBLE_API_KEY");
  const compatibleBaseUrl = configuredString(env, "OAC_OPENAI_COMPATIBLE_BASE_URL");
  if (compatibleKey && compatibleBaseUrl) {
    configs.push({
      provider: "openai-compatible",
      name: "OpenAI-compatible",
      apiKeyEnv: "OAC_OPENAI_COMPATIBLE_API_KEY",
      discoveryUrl: `${compatibleBaseUrl.replace(/\/$/, "")}/models`,
      baseUrl: compatibleBaseUrl,
      headers: { Authorization: `Bearer ${compatibleKey}` },
      mapModels: openAiModels,
    });
  }

  return configs;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider request failed";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240);
}

async function readJson(response: UndiciResponse): Promise<unknown> {
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("provider response exceeded the model list limit");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("provider returned invalid JSON");
  }
}

function modelName(config: ProviderConfig, discovered: DiscoveredModel): string {
  return `${config.name} · ${discovered.displayName ?? discovered.modelId}`.slice(0, 120);
}

function sourceKey(config: ProviderConfig, discovered: DiscoveredModel): string {
  return JSON.stringify([
    config.provider,
    discovered.modelId,
    config.apiKeyEnv,
    config.baseUrl,
  ]);
}

async function discoverProvider(
  config: ProviderConfig,
  fetchImpl: typeof undiciFetch,
  timeoutMs: number,
): Promise<DiscoveredModel[]> {
  const response = await fetchImpl(config.discoveryUrl, {
    method: "GET",
    headers: config.headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
  return config.mapModels(await readJson(response));
}

export async function syncConfiguredProviderModels(
  repository: RegistryRepository,
  options: ProviderSyncOptions = {},
): Promise<ProviderSyncSummary> {
  const env = options.env ?? process.env;
  const configs = providerConfigs(env);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  const logger = options.logger ?? defaultLogger;
  const timeoutMs = clamp(
    options.timeoutMs ?? Number(env.OAC_PROVIDER_DISCOVERY_TIMEOUT_MS),
    10_000,
    1_000,
    30_000,
  );
  const maxModels = clamp(
    options.maxModelsPerProvider ?? Number(env.OAC_PROVIDER_DISCOVERY_MAX_MODELS),
    500,
    1,
    2_000,
  );
  const existingModels = await repository.listModels();
  const registeredSources = new Set(
    existingModels.map((model) => JSON.stringify([
      model.provider,
      model.modelId,
      model.apiKeyEnv,
      model.baseUrl ?? null,
    ])),
  );
  const summary: ProviderSyncSummary = {
    providersConfigured: configs.length,
    providersConnected: 0,
    providersFailed: 0,
    modelsDiscovered: 0,
    modelsRegistered: 0,
  };

  const discoveries = await Promise.all(configs.map(async (config) => {
    try {
      const discovered = (await discoverProvider(config, fetchImpl, timeoutMs))
        .filter((model, index, all) => all.findIndex((candidate) => candidate.modelId === model.modelId) === index)
        .slice(0, maxModels);
      summary.providersConnected += 1;
      summary.modelsDiscovered += discovered.length;
      logger.info({ provider: config.name, models: discovered.length }, "provider models discovered");
      return { config, discovered };
    } catch (error) {
      summary.providersFailed += 1;
      logger.warn({ provider: config.name, error: safeErrorMessage(error) }, "provider discovery failed; skipping provider");
      return { config, discovered: [] };
    }
  }));

  for (const { config, discovered } of discoveries) {
    for (const model of discovered) {
      const source = sourceKey(config, model);
      if (registeredSources.has(source)) continue;
      const now = new Date().toISOString();
      const row: ModelInsert = {
        id: randomUUID(),
        name: modelName(config, model),
        provider: config.provider,
        modelId: model.modelId,
        baseUrl: config.baseUrl,
        apiKeyEnv: config.apiKeyEnv,
        enabled: true,
        temperature: null,
        maxTokens: null,
        capabilitiesJson: JSON.stringify(config.provider === "google" ? ["streaming", "tools"] : ["streaming"]),
        timeoutMs: 60_000,
        maxRetries: 2,
        createdAt: now,
        updatedAt: now,
      };
      await repository.insertModel(row);
      registeredSources.add(source);
      summary.modelsRegistered += 1;
    }
  }

  return summary;
}
