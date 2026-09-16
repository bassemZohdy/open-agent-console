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
      +--> Model Registry --------+
      |                           |
      +--> Agent Registry         |
      |                           v
      +--> Session / Run APIs --> AgentRuntimeManager
                                  |
                         cached LangChain createAgent()
                                  |
                 +----------------+----------------+
                 |                |                |
              OpenAI          Anthropic        Google
                 |                                 |
        OpenAI-compatible                         Gemini
                 |
              Ollama

SQLite stores models, agents, sessions, messages and runs.
```

## Registry boundaries

- **Model Registry** stores provider/model configuration, declared capabilities, timeout/retry defaults and an indirect environment-variable credential reference.
- **Agent Registry** stores instructions, model reference, generation overrides, enabled state and bounded model/tool-call limits.
- **Sessions and messages** are application-owned persisted conversation history.
- **Runs** capture status, correlation ID, provider token usage where available, duration inputs and errors.

Skills, tools/MCP and long-term memory remain separate upcoming registries rather than being embedded into agent JSON.

## Agent runtime lifecycle

`AgentRuntimeManager` resolves an enabled agent and model into a LangChain `createAgent()` runtime. Prepared runtimes are cached in-process using the agent/model `updatedAt` values as a deterministic cache key. Registry mutations invalidate the relevant cache entries.

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

## Operational baseline

- `/api/health` reports process health.
- `/api/ready` verifies the database can execute a query.
- Every request receives an `x-correlation-id`; agent runs persist the same correlation identifier.
- The Docker image contains migrations, OCI image metadata and a healthcheck.
- Model/API secrets are environment-variable references and are never stored in registry records.

## Security baseline

- Runtime inputs are validated with Zod.
- Request bodies are size-limited.
- Model calls have bounded retries/timeouts.
- Agent model/tool call counts are bounded.
- Arbitrary JavaScript execution is out of scope.
- HTTP/MCP tools will require explicit SSRF, timeout and output-size boundaries before they are enabled.

## Non-goals

No visual workflow editor, distributed runtime, agent-per-container execution, A2A, message broker, Kubernetes operator, plugin marketplace or enterprise RBAC is part of the current product boundary.
