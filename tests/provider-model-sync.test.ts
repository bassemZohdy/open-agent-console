import { describe, expect, it } from "vitest";
import { fetch as undiciFetch, Response } from "undici";
import { createDatabase } from "../src/server/db/index.js";
import { RegistryRepository } from "../src/server/db/repository.js";
import { syncConfiguredProviderModels } from "../src/server/runtime/provider-model-sync.js";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("provider model startup sync", () => {
  it("discovers configured providers, skips failures, and is idempotent", async () => {
    const connection = createDatabase(":memory:");
    const repository = new RegistryRepository(connection.db);
    const calls: string[] = [];
    const env = {
      OPENAI_API_KEY: "openai-secret",
      OPENROUTER_API_KEY: "openrouter-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      GOOGLE_API_KEY: "google-secret",
    } satisfies NodeJS.ProcessEnv;
    const fetchImpl: typeof undiciFetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      const headers = new Headers(init?.headers);
      if (url.includes("api.openai.com")) {
        expect(headers.get("authorization")).toBe("Bearer openai-secret");
        return jsonResponse({ data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4o" }] });
      }
      if (url.includes("openrouter.ai")) {
        expect(headers.get("authorization")).toBe("Bearer openrouter-secret");
        return jsonResponse({ error: "invalid key" }, 401);
      }
      if (url.includes("api.anthropic.com")) {
        expect(headers.get("x-api-key")).toBe("anthropic-secret");
        return jsonResponse({ data: [{ id: "claude-sonnet", display_name: "Claude Sonnet" }] });
      }
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(headers.get("x-goog-api-key")).toBe("google-secret");
      return jsonResponse({
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding-004",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      });
    };

    const first = await syncConfiguredProviderModels(repository, { env, fetchImpl });
    expect(first).toEqual({
      providersConfigured: 4,
      providersConnected: 3,
      providersFailed: 1,
      modelsDiscovered: 4,
      modelsRegistered: 4,
    });
    expect(calls).toHaveLength(4);
    expect((await repository.listModels()).map((model) => model.modelId).sort()).toEqual([
      "claude-sonnet",
      "gemini-2.0-flash",
      "gpt-4.1-mini",
      "gpt-4o",
    ]);

    const second = await syncConfiguredProviderModels(repository, { env, fetchImpl });
    expect(second.modelsDiscovered).toBe(4);
    expect(second.modelsRegistered).toBe(0);
    expect((await repository.listModels())).toHaveLength(4);

    connection.sqlite.close();
  });
});
