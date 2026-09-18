import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPinnedFetch } from "../src/server/runtime/tool-resolver.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind");
  return { server, port: address.port };
}

describe("pinned MCP transport", () => {
  it("rejects origin changes before making a network request", async () => {
    const pinned = createPinnedFetch({ url: new URL("http://example.com/mcp"), address: "93.184.216.34", family: 4 }, {});
    await expect(pinned.fetch("http://other.example/mcp")).rejects.toThrow("unpinned origin");
    await pinned.close();
  });

  it("rejects redirects and bounds streaming responses", async () => {
    const { port } = await start((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/ok" }).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("x".repeat(20_000));
    });
    process.env.OAC_MAX_MCP_RESPONSE_BYTES = "16384";
    const pinned = createPinnedFetch({ url: new URL(`http://127.0.0.1:${port}/mcp`), address: "127.0.0.1", family: 4 }, {});
    await expect(pinned.fetch(`http://127.0.0.1:${port}/redirect`)).rejects.toThrow();
    const response = await pinned.fetch(`http://127.0.0.1:${port}/mcp`);
    await expect(response.text()).rejects.toThrow("exceeds");
    await pinned.close();
    delete process.env.OAC_MAX_MCP_RESPONSE_BYTES;
  });
});
