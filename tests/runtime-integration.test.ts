import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";

describe("model to agent to chat integration", () => {
  it("streams through a local OpenAI-compatible fake endpoint", async () => {
    const requestBodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requestBodies.push(body);
        if (requestBodies.length === 1) expect(body).toContain("integration");
        expect(body).toContain("attachment context");
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
        payload: {
          message: "integration test",
          attachments: [
            {
              name: "notes.txt",
              mimeType: "text/plain",
              size: 17,
              text: "attachment context",
            },
          ],
        },
      });
      expect(chat.statusCode).toBe(200);
      expect(chat.body).toContain("local fake response");
      expect(chat.body).toContain("event: done");
      const sessions = await app.inject({ method: "GET", url: "/api/sessions?limit=10" });
      expect(sessions.statusCode).toBe(200);
      const sessionRows = sessions.json() as { items: Array<{ id: string; agentId: string }> };
      const session = sessionRows.items.find((row) => row.agentId === agent.id);
      expect(session).toBeDefined();
      const storedMessages = await app.inject({
        method: "GET",
        url: `/api/sessions/${session?.id}/messages`,
      });
      expect(storedMessages.statusCode).toBe(200);
      expect(storedMessages.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "integration test",
          attachments: [{ name: "notes.txt", mimeType: "text/plain", size: 17 }],
        }),
      ]));
      const followUp = await app.inject({
        method: "POST",
        url: `/api/agents/${agent.id}/chat`,
        payload: { message: "follow up", sessionId: session?.id },
      });
      expect(followUp.statusCode).toBe(200);
      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1]).toContain("attachment context");
      const runs = await app.inject({ method: "GET", url: "/api/runs?limit=10" });
      expect(runs.statusCode).toBe(200);
      const runRows = runs.json() as { items: Array<{ id: string; agentId: string }>; total: number };
      expect(runRows.total).toBeGreaterThanOrEqual(1);
      const run = runRows.items.find((row) => row.agentId === agent.id);
      expect(run).toBeDefined();
      const runDetail = await app.inject({ method: "GET", url: `/api/runs/${run?.id}` });
      expect(runDetail.statusCode).toBe(200);
      expect(runDetail.json()).toMatchObject({ status: "completed", toolCalls: [] });
      const rename = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${session?.id}`,
        payload: { title: "Renamed integration session" },
      });
      expect(rename.statusCode).toBe(200);
      const deleted = await app.inject({ method: "DELETE", url: `/api/sessions/${session?.id}` });
      expect(deleted.statusCode).toBe(204);
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
