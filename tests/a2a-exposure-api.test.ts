import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { credentialDigest } from "../src/server/app-dependencies.js";
import { createDatabase } from "../src/server/db/index.js";
import { RegistryRepository } from "../src/server/db/repository.js";

async function seedAgent(repository: RegistryRepository) {
  const now = new Date().toISOString();
  const modelId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  await repository.insertModel({
    id: modelId,
    name: "A2A test model",
    provider: "fake",
    modelId: "deterministic",
    apiKeyEnv: "",
    enabled: true,
    capabilitiesJson: "[\"streaming\"]",
    timeoutMs: 10_000,
    maxRetries: 0,
    createdAt: now,
    updatedAt: now,
  });
  await repository.insertAgent({
    id: agentId,
    name: "A2A test agent",
    description: "Agent exposed only through an admin-managed draft",
    modelRef: modelId,
    accessLevel: "user",
    instructions: "Never publish this internal prompt",
    enabled: true,
    maxModelCalls: 2,
    maxToolCalls: 2,
    createdAt: now,
    updatedAt: now,
  });
  return agentId;
}

describe("admin-managed A2A exposure drafts", () => {
  it("keeps exposure management admin-only and publishes a secure A2A endpoint", async () => {
    process.env.A2A_TEST_TOKEN = "test-a2a-token";
    const connection = createDatabase(":memory:");
    const repository = new RegistryRepository(connection.db);
    const agentId = await seedAgent(repository);
    const app = buildApp({
      auth: {
        accounts: [
          { username: "admin", passwordDigest: credentialDigest("admin"), role: "admin" },
          { username: "demo", passwordDigest: credentialDigest("demo"), role: "user" },
        ],
        sessionTtlMs: 60 * 60 * 1000,
        cookieName: "a2a_test_session",
        secureCookie: false,
      },
      repository,
      sqlite: connection.sqlite,
    });

    expect((await app.inject({ method: "GET", url: "/api/a2a/exposures" })).statusCode).toBe(401);

    const userLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "demo", password: "demo" },
    });
    const userCookie = String(userLogin.headers["set-cookie"]).split(";", 1)[0];
    expect(
      (await app.inject({ method: "GET", url: "/api/a2a/exposures", headers: { cookie: userCookie } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({
        method: "POST",
        url: "/api/a2a/exposures",
        headers: { cookie: userCookie },
        payload: { agentId, slug: "blocked-agent" },
      })).statusCode,
    ).toBe(403);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    const adminCookie = String(adminLogin.headers["set-cookie"]).split(";", 1)[0];
    const created = await app.inject({
      method: "POST",
      url: "/api/a2a/exposures",
      headers: { cookie: adminCookie },
      payload: {
        agentId,
        slug: "test-agent",
        visibility: "internal",
        authMode: "bearer",
        authEnv: "A2A_TEST_TOKEN",
        streaming: true,
        enabled: true,
        maxTaskSeconds: 120,
        maxRequestsPerMinute: 30,
        maxConcurrentTasks: 2,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      agentId,
      slug: "test-agent",
      published: false,
      status: "draft",
      transportReady: false,
      authEnv: "A2A_TEST_TOKEN",
      agent: { id: agentId, name: "A2A test agent" },
    });
    expect(created.json()).not.toHaveProperty("instructions");

    const exposureId = created.json().id as string;
    const publishAttempt = await app.inject({
      method: "PUT",
      url: `/api/a2a/exposures/${exposureId}`,
      headers: { cookie: adminCookie },
      payload: { published: true },
    });
    expect(publishAttempt.statusCode).toBe(200);
    expect(publishAttempt.json()).toMatchObject({ published: true, status: "published", transportReady: true });

    const card = await app.inject({ method: "GET", url: "/a2a/test-agent/.well-known/agent-card.json", headers: { authorization: "Bearer test-a2a-token" } });
    expect(card.statusCode).toBe(200);
    expect(card.json()).toMatchObject({
      name: "A2A test agent",
      defaultInputModes: ["text/plain"],
      capabilities: { streaming: true, pushNotifications: false },
    });
    expect(card.json()).not.toHaveProperty("instructions");

    const missingVersion = await app.inject({
      method: "POST",
      url: "/a2a/test-agent/message:send",
      headers: { authorization: "Bearer test-a2a-token" },
      payload: { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text: "hello" }] } },
    });
    expect(missingVersion.statusCode).toBe(400);
    expect(missingVersion.json()).toMatchObject({ error: { code: "VersionNotSupportedError" } });

    const submitted = await app.inject({
      method: "POST",
      url: "/a2a/test-agent/message:send",
      headers: { "content-type": "application/a2a+json", "a2a-version": "1.0", authorization: "Bearer test-a2a-token" },
      payload: { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text: "hello" }] } },
    });
    expect(submitted.statusCode).toBe(200);
    const task = submitted.json();
    expect(task).toMatchObject({ id: expect.any(String), status: { state: expect.stringMatching(/TASK_STATE_(SUBMITTED|WORKING|COMPLETED)/) } });

    let completed = task;
    for (let attempt = 0; attempt < 30 && completed.status.state !== "TASK_STATE_COMPLETED"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = (await app.inject({
        method: "GET",
        url: `/a2a/test-agent/tasks/${task.id}`,
        headers: { "a2a-version": "1.0", authorization: "Bearer test-a2a-token" },
      })).json();
    }
    expect(completed.status.state).toBe("TASK_STATE_COMPLETED");
    expect(completed.artifacts).toHaveLength(1);
    const duplicate = await app.inject({
      method: "POST",
      url: "/a2a/test-agent/message:send",
      headers: { "a2a-version": "1.0", authorization: "Bearer test-a2a-token" },
      payload: { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text: "hello" }] } },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(task.id);
    const stream = await app.inject({
      method: "POST",
      url: "/a2a/test-agent/message:stream",
      headers: { "content-type": "application/a2a+json", "a2a-version": "1.0", authorization: "Bearer test-a2a-token" },
      payload: { message: { messageId: "m-2", role: "ROLE_USER", parts: [{ text: "stream this" }] } },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    expect(stream.body).toContain("status-update");
    expect(stream.body).toContain("artifact-update");

    const list = await app.inject({
      method: "GET",
      url: "/api/a2a/exposures",
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    await app.close();
    connection.sqlite.close();
    delete process.env.A2A_TEST_TOKEN;
  });

  it("cascades an exposure when its agent is deleted", async () => {
    const connection = createDatabase(":memory:");
    const repository = new RegistryRepository(connection.db);
    const agentId = await seedAgent(repository);
    const exposureId = crypto.randomUUID();
    const now = new Date().toISOString();
    await repository.insertA2aExposure({
      id: exposureId,
      agentId,
      slug: "cascade-agent",
      published: false,
      visibility: "private",
      authMode: "bearer",
      authEnv: null,
      streaming: true,
      maxTaskSeconds: 300,
      maxRequestsPerMinute: 60,
      createdAt: now,
      updatedAt: now,
    });

    await repository.deleteAgent(agentId);
    expect(await repository.getA2aExposure(exposureId)).toBeUndefined();
    connection.sqlite.close();
  });
});
