# Architecture

## Intent

Open Agent Console is deliberately a modular monolith. The React control panel, Fastify REST/SSE API, LangChain runtime manager and SQLite persistence ship as one Node.js application and one Docker image.

Agents are configuration-backed logical runtime instances. They are not separate processes, services, pods or containers.

## Current architecture

```text
React control panel
      |
      v
Fastify REST + SSE API
      |
      +--> Models / Agents / Sessions / Runs --------+
      |                                               |
      +--> Skills / Tools / MCP / Memory foundations |
                                                      v
                                             AgentRuntimeManager
                                                      |
                                  +-------------------+-------------------+
                                  |                   |                   |
                           Effective prompt      Resolved tools      Memory connector
                                  |                   |                   |
                                  +-------------------+-------------------+
                                                      |
                                             cached LangChain createAgent()
                                                      |
                         +----------------------------+----------------------------+
                         |             |              |              |              |
                      OpenAI      Compatible      Anthropic        Google         Ollama
                                                                    Gemini

SQLite stores registry configuration, sessions, messages, runs, tool calls and memories.
```

## Registry boundaries

- **Model Registry** stores provider/model configuration, declared capabilities, timeout/retry defaults and an indirect environment-variable credential reference.
- **Agent Registry** stores instructions, model reference, optional ordered skill/tool references, optional memory connector reference, generation overrides, enabled state and bounded model/tool-call limits.
- **Skills Registry foundation** stores reusable enabled instructional content. The runtime adds enabled skills in deterministic mapping order.
- **Tools Registry foundation** stores built-in, HTTP and MCP tool definitions, JSON Schema inputs, enabled state and optional MCP server references.
- **Memory Connector foundation** distinguishes the `none` connector from SQLite long-term memory. Long-term memory is separate from session message history.
- **MCP Server foundation** stores HTTP MCP endpoints and environment-backed header references.
- **Sessions and messages** are application-owned persisted conversation history.
- **Runs** capture status, correlation ID, provider token usage where available, duration inputs and errors.
- **Tool Calls** capture runtime tool status, input, bounded output and failure details independently from the parent run.
- **Memories** store long-term content by agent and connector without being mixed into session messages.

The HTTP/UI surface exposes all registries, ordered agent mappings, effective-prompt inspection, settings transfer, sessions, runs and chat. Registry imports are versioned and deliberately omit secrets and long-term memories.

## Agent runtime lifecycle

`AgentRuntimeManager` resolves an enabled agent and model into a LangChain `createAgent()` runtime. It builds the effective system prompt from agent instructions, enabled ordered skills and loaded long-term memory, then resolves enabled built-in, HTTP and MCP tools. Prepared runtimes are cached in-process using the agent/model `updatedAt` values as a deterministic cache key. Registry mutations invalidate the relevant cache entries.

The runtime applies bounded model-call and tool-call middleware. A request may be cancelled through an `AbortSignal`; cancelled executions are persisted as such rather than failed runs.

Session history is loaded from SQLite for each request. LangChain is therefore not the source of truth for persisted conversation state.

## Model providers

Provider adapters currently support:

- OpenAI
- OpenAI-compatible endpoints
- Anthropic
- Google Gemini through `@langchain/google`
- Ollama

Model definitions expose declared capabilities plus configurable timeout and retry limits. A connection-test endpoint exercises the actual configured provider/model.

## Streaming contract

Chat responses use Server-Sent Events. Events are explicitly versioned (`version: 1`) and currently include:

- `session`
- `token`
- `usage`
- `done`
- `cancelled`
- `error`

The browser parser preserves incomplete frames between chunks. Assistant Markdown is rendered without raw HTML and passed through `rehype-sanitize`.

## Persistence and migrations

SQLite uses Node's built-in `node:sqlite` driver through Drizzle ORM. Startup applies versioned Drizzle v1 migrations from timestamped migration directories. The first migration is an idempotent baseline so databases created by the original bootstrap can be upgraded without deleting `/data`; subsequent migrations evolve that schema.

SQLite uses foreign-key enforcement, WAL mode and a busy timeout. API-level referential checks provide clearer conflict messages before database constraints are reached.

The `20260916030000_skills_tools_memory` migration adds skills, tools, MCP servers, memory connectors, agent mappings, tool calls and long-term memories, and seeds the safe calculator/date tools plus `none` and SQLite connector records. Existing databases are upgraded in place; `/data` must not be deleted during normal upgrades.

## Operational baseline

- `/api/health` reports process health.
- `/api/ready` verifies the database can execute a query.
- Every request receives an `x-correlation-id`; agent runs persist the same correlation identifier.
- The Docker image contains migrations, OCI image metadata and a healthcheck.
- Model/API secrets are environment-variable references and are never stored in registry records.
- CI verifies the application and Docker build on pull requests and `main`; successful `main` runs publish immutable SHA-tagged and `latest` images to Docker Hub.

## Security baseline

- Runtime inputs are validated with Zod.
- Request bodies are size-limited.
- Model calls have bounded retries/timeouts.
- Agent model/tool call counts are bounded.
- HTTP tools validate schemes, reject URL credentials, reject private/restricted DNS results, bound timeout/output and disable redirects.
- MCP credentials are resolved from environment variables rather than stored secret values.
- Arbitrary JavaScript execution is out of scope.
- HTTP/MCP registry exposure is available through the management surface. HTTP and MCP targets are checked against public DNS results before runtime access; HTTP calls additionally reject redirects and enforce timeout/output bounds.

## Non-goals

No visual workflow editor, distributed runtime, agent-per-container execution, A2A, message broker, Kubernetes operator, plugin marketplace or enterprise RBAC is part of the current product boundary.
