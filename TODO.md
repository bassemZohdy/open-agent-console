# Backlog

Completed work is intentionally removed from this file. The validated M1–M4 product foundation and the M5–M7 persistence/runtime foundations are implemented; this file tracks the remaining product surface and release work.

## M5 — Skills registry

- [ ] Add skills CRUD API and control-panel page.
- [ ] Expose agent skill mappings and ordering in the API and agent editor.
- [ ] Show effective prompt preview before running an agent.

## M6 — Tools registry

- [ ] Add tools, agent-tool mappings and MCP server CRUD APIs plus control-panel pages.
- [ ] Expose tool discovery and configuration validation in the management surface.
- [ ] Add focused tests for built-in, HTTP and MCP resolver safeguards.

## M7 — Memory connectors

- [ ] Add memory connector and long-term-memory CRUD APIs plus control-panel pages.
- [ ] Expose agent memory selection and memory management in the agent surface.
- [ ] Add focused tests for the `none` and SQLite connector runtimes.
- [ ] Keep the connector extension contract stable for future external providers.

## M8 — Product/operations

- [ ] Add settings page.
- [ ] Add import/export for registry configuration without secrets.

## M9 — Testing and release

- [ ] Add deterministic fake chat model for agent-runtime CI tests without paid credentials.
- [ ] Add full model→agent→chat integration test with a local fake OpenAI-compatible endpoint.
- [ ] Add frontend component tests.
- [ ] Add a versioned release workflow after the application stabilizes.
