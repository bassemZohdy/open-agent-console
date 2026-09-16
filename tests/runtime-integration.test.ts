import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";

describe("model to agent to chat integration", () => {
  it("streams through a local OpenAI-compatible fake endpoint", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        expect(body).toContain("integration");
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          connection: "keep-alive",
        });
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "local fake response" } }] })}\n\n`,
        );
        response.write("data: [DONE]\n\n");
        response.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fake endpoint did not bind");
    const app = buildApp();
    const suffix = crypto.randomUUID().slice(0, 8);
    const previousKey = process.env.OAC_TEST_API_KEY;
    process.env.OAC_TEST_API_KEY = "test-key";
    try {
      const modelResponse = await app.inject({
        method: "POST",
        url: "/api/models",
        payload: {
          name: `Compatible ${suffix}`,
          provider: "openai-compatible",
          modelId: "fake-chat",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeyEnv: "OAC_TEST_API_KEY",
          capabilities: ["streaming"],
          timeoutMs: 10000,
          maxRetries: 0,
        },
      });
      expect(modelResponse.statusCode).toBe(201);
      const model = modelResponse.json() as { id: string };
      const agentResponse = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          name: `Integration ${suffix}`,
          modelRef: model.id,
          instructions: "Return the local integration response.",
          maxModelCalls: 3,
          maxToolCalls: 5,
        },
      });
      const agent = agentResponse.json() as { id: string };
      const chat = await app.inject({
        method: "POST",
        url: `/api/agents/${agent.id}/chat`,
        payload: { message: "integration test" },
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.body).toContain("local fake response");
      expect(chat.body).toContain("event: done");
      await app.inject({ method: "DELETE", url: `/api/agents/${agent.id}` });
      await app.inject({ method: "DELETE", url: `/api/models/${model.id}` });
    } finally {
      if (previousKey === undefined) delete process.env.OAC_TEST_API_KEY;
      else process.env.OAC_TEST_API_KEY = previousKey;
      await app.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30000);
});
