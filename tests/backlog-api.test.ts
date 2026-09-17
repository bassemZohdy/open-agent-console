import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { RegistryRepository } from "../src/server/db/repository.js";
import { resolveTools } from "../src/server/runtime/tool-resolver.js";

describe("M5-M8 management APIs", () => {
  it("manages registries, ordered agent mappings, prompt previews and memory", async () => {
    const app = buildApp();
    const suffix = crypto.randomUUID().slice(0, 8);
    const model = (
      await app.inject({
        method: "POST",
        url: "/api/models",
        payload: {
          name: `Fake ${suffix}`,
          provider: "fake",
          modelId: "deterministic",
          apiKeyEnv: "",
          capabilities: ["streaming"],
          timeoutMs: 10000,
          maxRetries: 0,
        },
      })
    ).json() as { id: string };
    const fakeTest = await app.inject({ method: "POST", url: `/api/models/${model.id}/test` });
    expect(fakeTest.statusCode).toBe(200);
    const skill = (
      await app.inject({
        method: "POST",
        url: "/api/skills",
        payload: {
          name: `Skill ${suffix}`,
          description: "Test skill",
          instructions: "Always state the operating mode.",
        },
      })
    ).json() as { id: string };
    const connector = (
      await app.inject({
        method: "POST",
        url: "/api/memory-connectors",
        payload: { name: `Memory ${suffix}`, type: "sqlite", config: {} },
      })
    ).json() as { id: string };
    const mcp = (
      await app.inject({
        method: "POST",
        url: "/api/mcp-servers",
        payload: {
          name: `MCP ${suffix}`,
          url: "https://example.com",
          headers: { Authorization: { env: "TEST_AUTH_TOKEN" } },
        },
      })
    ).json() as { id: string };
    const tool = (
      await app.inject({
        method: "POST",
        url: "/api/tools",
        payload: {
          name: `HTTP ${suffix}`,
          description: "Bounded HTTP action",
          kind: "http",
          config: {
            url: "https://example.com",
            method: "GET",
            headers: { Authorization: { env: "TEST_AUTH_TOKEN" } },
          },
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
            additionalProperties: false,
          },
        },
      })
    ).json() as { id: string };
    const mcpTool = await app.inject({
      method: "POST",
      url: "/api/tools",
      payload: {
        name: `MCP ${suffix}`,
        description: "MCP action",
        kind: "mcp",
        mcpServerId: mcp.id,
        externalName: "remote_tool",
        inputSchema: { type: "object" },
      },
    });
    expect(mcpTool.statusCode).toBe(201);
    const calculator = (await app.inject({
      method: "POST",
      url: "/api/tools",
      payload: {
        name: `Calculator ${suffix}`,
        description: "Safe arithmetic",
        kind: "builtin-calculator",
        inputSchema: { type: "object" },
      },
    })).json() as { id: string };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tools/validate",
          payload: {
            name: "bad",
            description: "bad",
            kind: "http",
            config: { url: "ftp://example.com" },
            inputSchema: { type: "object" },
          },
        })
      ).statusCode,
    ).toBe(400);

    const agentResponse = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: `Agent ${suffix}`,
        modelRef: model.id,
        memoryConnectorId: connector.id,
        instructions: "Be concise.",
        skillIds: [skill.id],
        toolIds: [tool.id, calculator.id],
        maxModelCalls: 3,
        maxToolCalls: 5,
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json() as {
      id: string;
      skillIds: string[];
      toolIds: string[];
      memoryConnectorId: string;
    };
    expect(agent).toMatchObject({
      skillIds: [skill.id],
      toolIds: [tool.id, calculator.id],
      memoryConnectorId: connector.id,
    });
    const resolved = await resolveTools(new RegistryRepository(), agent.id);
    expect(await resolved.tools.find((item) => item.name === `Calculator ${suffix}`)?.invoke({ expression: "2 + 3 * 4" })).toBe("14");
    await expect(resolved.tools.find((item) => item.name === `Calculator ${suffix}`)?.invoke({ expression: "1 / 0" })).rejects.toThrow("Division by zero");
    await resolved.dispose();

    const memory = await app.inject({
      method: "POST",
      url: `/api/agents/${agent.id}/memories`,
      payload: {
        key: "mode",
        content: "test mode",
        metadata: { source: "test" },
      },
    });
    expect(memory.statusCode).toBe(201);
    const prompt = await app.inject({
      method: "GET",
      url: `/api/agents/${agent.id}/effective-prompt`,
    });
    expect(prompt.statusCode).toBe(200);
    expect((prompt.json() as { prompt: string }).prompt).toContain(
      "Always state the operating mode.",
    );
    expect((prompt.json() as { prompt: string }).prompt).toContain(
      "mode: test mode",
    );

    const exported = await app.inject({
      method: "GET",
      url: "/api/registry/export",
    });
    expect(exported.statusCode).toBe(200);
    const exportBody = exported.json() as {
      tools: Array<{ config: Record<string, unknown> }>;
      mcpServers: Array<{ headers: Record<string, unknown> }>;
      omitted: string[];
    };
    expect(JSON.stringify(exportBody)).toContain("TEST_AUTH_TOKEN");
    expect(exportBody.omitted.join(" ")).toContain("long-term memories");
    const imported = await app.inject({ method: "POST", url: "/api/registry/import", payload: exportBody });
    expect(imported.statusCode).toBe(202);

    const noneAgentResponse = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: `None ${suffix}`,
        modelRef: model.id,
        instructions: "No memory.",
        maxModelCalls: 3,
        maxToolCalls: 5,
      },
    });
    const noneAgent = noneAgentResponse.json() as { id: string };
    const noneMemory = await app.inject({
      method: "GET",
      url: `/api/agents/${noneAgent.id}/memories`,
    });
    expect(noneMemory.statusCode).toBe(200);
    expect(noneMemory.json()).toMatchObject({ connector: null, items: [] });

    await app.inject({ method: "DELETE", url: `/api/agents/${agent.id}` });
    await app.inject({ method: "DELETE", url: `/api/agents/${noneAgent.id}` });
    const mcpToolId = (mcpTool.json() as { id: string }).id;
    await app.inject({ method: "DELETE", url: `/api/tools/${mcpToolId}` });
    await app.inject({ method: "DELETE", url: `/api/tools/${tool.id}` });
    await app.inject({ method: "DELETE", url: `/api/tools/${calculator.id}` });
    await app.inject({ method: "DELETE", url: `/api/skills/${skill.id}` });
    await app.inject({ method: "DELETE", url: `/api/mcp-servers/${mcp.id}` });
    await app.inject({
      method: "DELETE",
      url: `/api/memory-connectors/${connector.id}`,
    });
    await app.inject({ method: "DELETE", url: `/api/models/${model.id}` });
    await app.close();
  });
});
