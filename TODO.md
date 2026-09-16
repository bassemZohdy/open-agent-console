# Backlog

Completed work is intentionally removed from this file. The validated M1–M4 foundation milestones are now implemented; this file tracks only remaining work.

## M5 — Skills registry

- [ ] Add skills table, CRUD API and control-panel page.
- [ ] Allow agents to reference multiple skills.
- [ ] Build deterministic effective system prompts from agent instructions + ordered skills.
- [ ] Show effective prompt preview before running an agent.

## M6 — Tools registry

- [ ] Add tool registry and agent-tool mappings.
- [ ] Add a minimal safe built-in calculator/date tool set.
- [ ] Add HTTP tools with JSON Schema inputs, timeouts, output limits and SSRF protections.
- [ ] Add MCP server registry and MCP tool discovery.
- [ ] Record tool calls and failures in run history.

## M7 — Memory connectors

- [ ] Add memory connector registry.
- [ ] Add `none` and SQLite long-term memory connectors.
- [ ] Keep long-term memory distinct from persisted conversation history.
- [ ] Define the extension contract for future external memory providers.

## M8 — Product/operations

- [ ] Add settings page.
- [ ] Add import/export for registry configuration without secrets.

## M9 — Testing and release

- [ ] Add deterministic fake chat model for agent-runtime CI tests without paid credentials.
- [ ] Add full model→agent→chat integration test with a local fake OpenAI-compatible endpoint.
- [ ] Add frontend component tests.
- [ ] Generate and commit `package-lock.json` from the validated toolchain.
- [ ] Add release workflow only after the application stabilizes.
