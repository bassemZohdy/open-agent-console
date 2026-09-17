import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";

describe("backlog hardening", () => {
  it("rejects raw secret values in outbound configuration", async () => {
    const app = buildApp();
    const mcp = await app.inject({
      method: "POST",
      url: "/api/mcp-servers",
      payload: {
        name: "Raw secret MCP",
        url: "https://example.com",
        headers: { Authorization: "Bearer should-not-persist" },
      },
    });
    expect(mcp.statusCode).toBe(400);

    const tool = await app.inject({
      method: "POST",
      url: "/api/tools",
      payload: {
        name: "Raw secret HTTP",
        description: "Should be rejected",
        kind: "http",
        config: {
          url: "https://example.com",
          headers: { Authorization: "Bearer should-not-persist" },
        },
        inputSchema: { type: "object" },
      },
    });
    expect(tool.statusCode).toBe(400);
    await app.close();
  });

  it("rolls back an import when a later reference is invalid", async () => {
    const app = buildApp();
    const modelId = crypto.randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/registry/import",
      payload: {
        version: 1,
        models: [
          {
            id: modelId,
            name: "Should roll back",
            provider: "fake",
            modelId: "deterministic",
            apiKeyEnv: "",
            capabilities: ["streaming"],
            timeoutMs: 10000,
            maxRetries: 0,
          },
        ],
        agents: [
          {
            id: crypto.randomUUID(),
            name: "Invalid reference",
            modelRef: crypto.randomUUID(),
            instructions: "This must not be persisted",
            maxModelCalls: 2,
            maxToolCalls: 2,
            skillIds: [],
            toolIds: [],
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    const models = (await app.inject({ method: "GET", url: "/api/models" })).json() as Array<{ id: string }>;
    expect(models.some((model) => model.id === modelId)).toBe(false);
    await app.close();
  });

  it("refreshes a cached runtime after memory changes", async () => {
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        bodies.push(body);
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fake endpoint did not bind");
    const app = buildApp();
    const previous = process.env.OAC_CACHE_TEST_KEY;
    process.env.OAC_CACHE_TEST_KEY = "test";
    try {
      const model = (await app.inject({
        method: "POST",
        url: "/api/models",
        payload: {
          name: "Cache test model",
          provider: "openai-compatible",
          modelId: "cache-test",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeyEnv: "OAC_CACHE_TEST_KEY",
          capabilities: ["streaming"],
          timeoutMs: 10000,
          maxRetries: 0,
        },
      })).json() as { id: string };
      const connector = (await app.inject({
        method: "POST",
        url: "/api/memory-connectors",
        payload: { name: "Cache memory", type: "sqlite", config: {} },
      })).json() as { id: string };
      const agent = (await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          name: "Cache agent",
          modelRef: model.id,
          memoryConnectorId: connector.id,
          instructions: "Use memory.",
        },
      })).json() as { id: string };
      const memory = (await app.inject({
        method: "POST",
        url: `/api/agents/${agent.id}/memories`,
        payload: { content: "initial fact", metadata: {} },
      })).json() as { id: string };
      await app.inject({ method: "POST", url: `/api/agents/${agent.id}/chat`, payload: { message: "first" } });
      await app.inject({
        method: "PUT",
        url: `/api/agents/${agent.id}/memories/${memory.id}`,
        payload: { content: "updated fact" },
      });
      await app.inject({ method: "POST", url: `/api/agents/${agent.id}/chat`, payload: { message: "second" } });
      expect(bodies.length).toBe(2);
      expect(bodies[0]).toContain("initial fact");
      expect(bodies[1]).toContain("updated fact");
      expect(bodies[1]).not.toContain("initial fact");
      await app.close();
    } finally {
      if (previous === undefined) delete process.env.OAC_CACHE_TEST_KEY;
      else process.env.OAC_CACHE_TEST_KEY = previous;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
