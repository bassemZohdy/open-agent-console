import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { credentialDigest } from "../src/server/app-dependencies.js";
import { createDatabase } from "../src/server/db/index.js";
import { RegistryRepository } from "../src/server/db/repository.js";

describe("runtime roles and agent access", () => {
  it("authenticates the configured demo accounts and scopes API access by session", async () => {
    const connection = createDatabase(":memory:");
    const app = buildApp({
      auth: {
        accounts: [
          { username: "admin", passwordDigest: credentialDigest("admin"), role: "admin" },
          { username: "demo", passwordDigest: credentialDigest("demo"), role: "user" },
        ],
        sessionTtlMs: 60 * 60 * 1000,
        cookieName: "test_session",
        secureCookie: false,
      },
      repository: new RegistryRepository(connection.db),
      sqlite: connection.sqlite,
    });

    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json()).toMatchObject({
      authenticated: false,
    });
    expect((await app.inject({ method: "GET", url: "/api/models" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/agents" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/sessions" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/runs" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/settings" })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${crypto.randomUUID()}` })).statusCode).toBe(404);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({ error: "Invalid username or password" });

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    expect(adminLogin.statusCode).toBe(200);
    const adminCookie = String(adminLogin.headers["set-cookie"]).split(";", 1)[0];
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: { cookie: adminCookie } })).statusCode).toBe(200);

    const userLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "demo", password: "demo" },
    });
    const userCookie = String(userLogin.headers["set-cookie"]).split(";", 1)[0];
    expect(userLogin.json()).toMatchObject({ authenticated: true, username: "demo", role: "user" });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: userCookie } })).json()).toMatchObject({
      authenticated: true,
      username: "demo",
      role: "user",
    });
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: { cookie: userCookie } })).statusCode).toBe(403);

    await app.close();
    connection.sqlite.close();
  });

  it("blocks user configuration access at the API boundary", async () => {
    const connection = createDatabase(":memory:");
    const app = buildApp({
      role: "user",
      repository: new RegistryRepository(connection.db),
      sqlite: connection.sqlite,
    });

    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).json()).toMatchObject({
      role: "user",
    });
    expect((await app.inject({ method: "GET", url: "/api/settings" })).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: "POST",
        url: "/api/models",
        payload: {
          name: "Blocked model",
          provider: "fake",
          modelId: "deterministic",
          apiKeyEnv: "",
          capabilities: ["streaming"],
          timeoutMs: 10000,
          maxRetries: 0,
        },
      })).statusCode,
    ).toBe(403);

    await app.close();
    connection.sqlite.close();
  });

  it("filters agents by role access level", async () => {
    const connection = createDatabase(":memory:");
    const repository = new RegistryRepository(connection.db);
    const now = new Date().toISOString();
    const modelId = crypto.randomUUID();
    await repository.insertModel({
      id: modelId,
      name: "Role test model",
      provider: "fake",
      modelId: "deterministic",
      apiKeyEnv: "",
      enabled: true,
      capabilitiesJson: "[\"streaming\"]",
      timeoutMs: 10000,
      maxRetries: 0,
      createdAt: now,
      updatedAt: now,
    });
    for (const accessLevel of ["guest", "user", "admin"] as const) {
      await repository.insertAgent({
        id: crypto.randomUUID(),
        name: `${accessLevel} agent`,
        modelRef: modelId,
        accessLevel,
        instructions: "Role test",
        enabled: true,
        maxModelCalls: 2,
        maxToolCalls: 2,
        createdAt: now,
        updatedAt: now,
      });
    }

    const guestApp = buildApp({ role: "guest", repository, sqlite: connection.sqlite });
    const guestAgents = (await guestApp.inject({ method: "GET", url: "/api/agents" })).json() as Array<{ name: string }>;
    expect(guestAgents.map(({ name }) => name).sort()).toEqual(["guest agent"]);
    await guestApp.close();

    const userApp = buildApp({ role: "user", repository, sqlite: connection.sqlite });
    const userAgents = (await userApp.inject({ method: "GET", url: "/api/agents" })).json() as Array<{ name: string }>;
    expect(userAgents.map(({ name }) => name).sort()).toEqual(["guest agent", "user agent"]);
    await userApp.close();
    connection.sqlite.close();
  });

  it("scopes direct session operations to agents visible to the role", async () => {
    const connection = createDatabase(":memory:");
    const repository = new RegistryRepository(connection.db);
    const now = new Date().toISOString();
    const modelId = crypto.randomUUID();
    const guestAgentId = crypto.randomUUID();
    const adminAgentId = crypto.randomUUID();
    const guestSessionId = crypto.randomUUID();
    const adminSessionId = crypto.randomUUID();
    await repository.insertModel({
      id: modelId,
      name: "Session access model",
      provider: "fake",
      modelId: "deterministic",
      apiKeyEnv: "",
      enabled: true,
      capabilitiesJson: "[\"streaming\"]",
      timeoutMs: 10000,
      maxRetries: 0,
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, accessLevel] of [
      [guestAgentId, "guest"],
      [adminAgentId, "admin"],
    ] as const) {
      await repository.insertAgent({
        id,
        name: `${accessLevel} session agent`,
        modelRef: modelId,
        accessLevel,
        instructions: "Session access test",
        enabled: true,
        maxModelCalls: 2,
        maxToolCalls: 2,
        createdAt: now,
        updatedAt: now,
      });
    }
    await repository.insertSession({
      id: guestSessionId,
      agentId: guestAgentId,
      title: "Guest conversation",
      createdAt: now,
      updatedAt: now,
    });
    await repository.insertSession({
      id: adminSessionId,
      agentId: adminAgentId,
      title: "Admin conversation",
      createdAt: now,
      updatedAt: now,
    });

    const guestApp = buildApp({ role: "guest", repository, sqlite: connection.sqlite });
    const sessions = (await guestApp.inject({ method: "GET", url: "/api/sessions" })).json() as {
      items: Array<{ id: string }>;
    };
    expect(sessions.items.map(({ id }) => id)).toEqual([guestSessionId]);
    expect(
      (await guestApp.inject({ method: "PATCH", url: `/api/sessions/${adminSessionId}`, payload: { title: "Nope" } })).statusCode,
    ).toBe(404);
    expect(
      (await guestApp.inject({ method: "DELETE", url: `/api/sessions/${adminSessionId}` })).statusCode,
    ).toBe(404);
    expect(
      (await guestApp.inject({ method: "GET", url: `/api/sessions/${adminSessionId}/messages` })).statusCode,
    ).toBe(404);
    expect(
      (await guestApp.inject({ method: "PATCH", url: `/api/sessions/${guestSessionId}`, payload: { title: "Renamed" } })).statusCode,
    ).toBe(200);
    expect(
      (await guestApp.inject({ method: "DELETE", url: `/api/sessions/${guestSessionId}` })).statusCode,
    ).toBe(204);
    await guestApp.close();
    connection.sqlite.close();
  });
});
