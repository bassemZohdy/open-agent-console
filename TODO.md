# Backlog

The bootstrap focuses on the first usable vertical slice. Completed bootstrap work is intentionally not repeated here.

## M1 — Harden persistence

- [ ] Replace startup `CREATE TABLE IF NOT EXISTS` bootstrap with versioned Drizzle migrations.
- [ ] Add repository/service tests for model, agent, session and run persistence.
- [ ] Add pagination to session and run APIs.
- [ ] Add safe delete/update operations and referential-integrity UX.

## M2 — Model registry

- [ ] Add model connection test from the UI.
- [ ] Add Anthropic provider adapter.
- [ ] Add Google Gemini provider adapter.
- [ ] Add Ollama provider adapter.
- [ ] Add model capabilities metadata and validation.
- [ ] Add configurable timeout/retry defaults.

## M3 — Agent management

- [ ] Add edit, duplicate, enable/disable and delete actions.
- [ ] Add agent temperature/max-token controls to the UI.
- [ ] Add runtime instance cache with deterministic invalidation after configuration changes.
- [ ] Add configurable max model/tool call limits using LangChain middleware.

## M4 — Chat and sessions

- [ ] Add existing-session reopening and message loading in the chat drawer.
- [ ] Add cancel/abort for a running response.
- [ ] Persist provider token-usage metadata where available.
- [ ] Improve SSE event schema and client parser tests.
- [ ] Add markdown rendering with safe sanitization.

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

- [ ] Add dashboard recent-run/error widgets.
- [ ] Add settings page.
- [ ] Add import/export for registry configuration without secrets.
- [ ] Add structured request/run correlation IDs.
- [ ] Add graceful handling of SQLite busy/locked conditions.
- [ ] Add Docker healthcheck and image metadata.

## M9 — Testing and release

- [ ] Add deterministic fake chat model for agent-runtime CI tests without paid credentials.
- [ ] Add full model→agent→chat integration test with a local fake OpenAI-compatible endpoint.
- [ ] Add frontend component tests.
- [ ] Generate and commit `package-lock.json` from the validated toolchain.
- [ ] Add release workflow only after the application stabilizes.
