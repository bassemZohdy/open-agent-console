# Architecture

## Intent

Open Agent Console is deliberately a modular monolith. The control panel, REST/SSE API, agent runtime manager and SQLite persistence ship as one Node.js application and one Docker image.

## Current vertical slice

```text
React control panel
      |
      v
Fastify REST + SSE API
      |
      +--> Model Registry ----+
      |                       |
      +--> Agent Registry     |
      |                       v
      +----------------> AgentRuntimeManager
                              |
                              v
                      LangChain createAgent()
                              |
                              v
                      ChatOpenAI adapter
                              |
                              v
                   OpenAI-compatible endpoint

SQLite stores models, agents, sessions, messages and runs.
```

## Architectural boundaries

- **Registry records** describe reusable configuration.
- **AgentRuntimeManager** resolves a definition into a logical runtime instance. Agents are not processes or containers.
- **Secrets** are indirect: model records reference an environment-variable name rather than storing API keys.
- **Session history** is persisted by the application. LangChain is currently stateless between calls and receives the saved conversation history.
- **Streaming** is exposed to the browser as Server-Sent Events.

## Initial model support

The first slice uses `ChatOpenAI` for official OpenAI and OpenAI-compatible endpoints. Provider-specific adapters for Anthropic, Gemini and Ollama are backlog items so provider breadth does not delay the first usable product.

## Persistence

SQLite is accessed with Node's built-in `node:sqlite` driver through Drizzle ORM. The bootstrap currently creates the initial schema idempotently at startup; replacing that bootstrap mechanism with versioned Drizzle migrations is an early backlog item.

## Security baseline

- API keys are read from environment variables.
- API responses never return secret values.
- Request payloads are validated with Zod.
- Request body size is limited.
- Model calls have a timeout and bounded retry count.
- Arbitrary JavaScript execution is explicitly out of scope.
- HTTP/MCP tools will require separate security boundaries before implementation.

## Non-goals

No workflow editor, distributed runtime, agent-per-container execution, A2A, message broker, Kubernetes operator, plugin marketplace, or enterprise RBAC in v1.
