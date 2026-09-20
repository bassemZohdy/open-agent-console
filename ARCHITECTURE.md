# Architecture

## Design intent

Open Agent Console is a modular monolith. The React control panel, Fastify REST/SSE API, LangChain runtime, and SQLite persistence are built and shipped as one Node.js application and one Docker image.

An agent is a logical runtime configuration. It does not get its own process, container, database, or network identity. This keeps local operation, deployment, and backup simple while still allowing many differently configured agents to coexist.

## System shape

    Browser / React SPA
          |
          | REST requests and SSE chat stream
          v
    Fastify application
      |       |        |
      |       |        +--> health, readiness, settings, registry transfer
      |       +-----------> admin-managed A2A exposure registry and gateway
      |       +-----------> registry/session/run routes
      +-------------------> AgentRuntimeManager
                                  |
              +-------------------+--------------------+
              |                   |                    |
        prompt builder       tool resolver        memory resolver
              |                   |                    |
              +-------------------+--------------------+
                                  |
                         LangChain createAgent()
                                  |
        +-------------+------------+-------------+-------------+
        |             |            |             |             |
      OpenAI     compatible   Anthropic      Gemini        Ollama
                                  |
                                fake

SQLite stores configuration, sessions, messages, runs, tool calls, and long-term memories. Published A2A tasks and audit events are stored in the same database and execute through the existing in-process runtime.

## Component responsibilities

### Web application

The React/Vite SPA is a management surface, not a second runtime. It loads registry data through the API, keeps editor state locally, and renders streaming chat events. It must not contain provider credentials or make provider calls directly.

### Fastify API

The API owns validation, status codes, correlation IDs, registry lifecycle, session/run persistence, SSE framing, and dependency composition. Request payloads are parsed by Zod schemas before repository operations.

### Registry repository

The repository is the persistence seam around Drizzle and SQLite. Routes use it for registry and history operations; tests can inject an isolated database and repository without starting a server or provider.

### AgentRuntimeManager

The manager:

1. verifies that the requested agent and model are enabled;
2. loads ordered skills, the selected memory connector, and enabled tools;
3. builds the effective system prompt;
4. creates or reuses a bounded LangChain runtime;
5. streams model output; and
6. persists messages, run status, usage, errors, and tool calls.

The cache key includes agent/model timestamps and the relevant skill, tool, MCP-server, and memory records. Any registry mutation invalidates affected prepared runtimes.

### Runtime adapters

Model creation is isolated in the provider factory. Tool creation is isolated in the tool resolver. Memory connector implementations expose a small load interface. These seams keep provider-specific behavior out of route handlers and make deterministic fake-model tests possible.

## Registries and relationships

| Record | Purpose | Runtime effect |
| --- | --- | --- |
| Model | Provider, model ID, base URL, credential variable, capabilities, timeout, retries | Creates the LangChain chat model |
| Agent | Instructions, model reference, limits, enabled state, memory connector | Defines an executable logical agent |
| Skill | Reusable name, instructions, enabled state | Adds an ordered prompt section |
| Agent skill mapping | Agent-to-skill relationship and position | Determines prompt order |
| Tool | Built-in, HTTP, or MCP definition, schema, enabled state | Adds a callable tool |
| Agent tool mapping | Agent-to-tool relationship and position | Determines available tool set |
| MCP server | Endpoint and environment-backed headers | Supplies tools discovered from Streamable HTTP |
| Memory connector | none or SQLite runtime | Selects long-term-memory behavior |
| Memory | Key/content/metadata by agent and connector | Adds bounded long-term context |
| A2A exposure | Admin-owned slug, visibility, auth reference, limits, and publication state | Controls a published A2A interface and its rollback switch |
| A2A task/audit event | Caller-bound task lifecycle, session/run mapping, correlation, and security event | Supports HTTP+JSON polling, SSE, cancellation, idempotency, and operational evidence |
| Session/message | Application-owned conversation history and bounded attachment context | Supplies bounded model input and durable message references |
| Run | Execution status, timing, correlation, usage, error | Provides operational history |
| Tool call | Per-call input/output/status/error | Provides tool execution audit detail |

Models cannot be deleted while referenced by an agent. Registry imports are transactional and preserve established record IDs where possible. Long-term memories and runtime history are intentionally excluded from export.

## Request lifecycle

### Configuration mutation

1. The browser submits a JSON request.
2. Fastify parses and validates the payload.
3. The route checks references and conflict rules.
4. The repository writes the record and update timestamp.
5. The runtime manager invalidates stale cache entries.
6. The route returns the validated representation or a structured error.

### Chat

1. The browser posts a message and bounded attachment descriptors/extracted text to the agent chat endpoint.
2. Fastify creates or validates the session, stores the user message with attachment metadata and bounded extracted text, and creates a running run with a correlation ID.
3. The manager loads recent history and applies message/character bounds.
4. The manager composes instructions, enabled ordered skills, and bounded memory.
5. Enabled built-in, HTTP, and MCP tools are resolved and wrapped for call auditing.
6. LangChain streams tokens and usage through the SSE adapter.
7. Completed assistant text, run status, usage, and tool-call results are persisted.
8. Cancellation produces a cancelled run; failures produce a structured error event and failed run.

The database remains authoritative even when a client disconnects. A client can later inspect the run and session state; reopened messages expose safe attachment summaries, while stored bounded text is included in future model history. Original binary files are intentionally not uploaded or stored.

### A2A task lifecycle

Published exposures are routed under `/a2a/:slug`. The Agent Card is served from the exposure's well-known path and advertises only text input/output, supported capabilities, skills, and the required bearer scheme when configured. A2A callers use `A2A-Version: 1.0`; their bearer credential is resolved from the configured environment variable and is never persisted. Console cookies and UI roles are not accepted for external transport.

`POST message:send` creates a durable A2A task with a caller-supplied message ID. The task manager returns an existing task for a retry with the same exposure/message ID and caller fingerprint. A task receives a context ID, correlation ID, and (after runtime start) a session/run mapping. The state mapping is `SUBMITTED -> WORKING -> COMPLETED|FAILED|CANCELED`; polling reads the task from SQLite, while SSE emits status and artifact updates when streaming is enabled. Cancellation aborts the in-process runtime and is idempotent for terminal tasks. On process restart, interrupted non-terminal tasks are marked failed with `SERVICE_RESTARTED` rather than resumed without a worker lease.

## Prompt and context composition

The effective prompt is deterministic:

1. agent instructions;
2. enabled skills in explicit mapping order; and
3. relevant memory rows from the selected connector.

Prompt size, memory row count, history message count, and history character count are bounded by environment configuration. When the newest content cannot all fit, the run is marked with context truncation metadata. The application never claims that long-term memory came from the current conversation.

## Streaming contract

Chat uses media type text/event-stream with version 1 events:

| Event | Meaning |
| --- | --- |
| session | Session ID, run ID, and correlation ID |
| token | Incremental assistant text |
| usage | Provider token usage when available |
| done | Successful completion |
| cancelled | Abort signal was observed |
| error | Bounded error message and optional code/correlation ID |

The browser parser preserves partial frames between network chunks. Markdown is rendered without raw HTML and passed through sanitization.

## Persistence and migrations

SQLite is opened through Node's built-in SQLite driver and Drizzle ORM. Startup:

1. creates the parent directory when necessary;
2. enables foreign keys;
3. enables WAL mode and a busy timeout; and
4. applies pending Drizzle migrations.

The first migration is an idempotent baseline. Later timestamped migrations add registries, runtime hardening, context bounds, and related indexes/constraints. Existing databases are upgraded in place; deleting /data is not a normal upgrade step.

The schema separates short-lived conversation messages from long-term memories. Foreign keys and application-level checks provide both data integrity and readable conflict errors.

## Security boundaries

The application supports environment-backed demo credentials and HttpOnly session cookies for Admin, User, and optional Guest access. Sessions are process-local and expire according to `OAC_SESSION_TTL_MS`; operators must keep it on localhost or add an authenticated TLS reverse proxy before network exposure.

Controls include:

- Zod validation and bounded request bodies;
- credential indirection through environment-variable names;
- rejection of secret-like raw HTTP/MCP header values;
- bounded model retries, timeouts, model calls, tool calls, prompt context, history, and MCP output;
- HTTP/MCP public-DNS validation before connection;
- pinned HTTP connections and no HTTP redirects;
- MCP origin-changing redirect rejection and bounded reconnect behavior;
- JSON Schema validation for tool input;
- sanitized Markdown with raw HTML disabled;
- admin-only A2A exposure management with draft/private and disabled defaults, environment-variable auth references, caller-bound bearer authentication, rate/concurrency/time limits, task persistence, and audit events; and
- non-root Docker runtime, localhost Compose binding, and healthchecks.

Arbitrary JavaScript execution, untrusted plugin installation, and per-agent isolation are outside the current boundary.

## Deployment shape

The production image is multi-stage:

1. the build stage installs all dependencies and compiles server and web assets;
2. the runtime stage installs production dependencies, copies compiled assets and migrations, creates /data, and runs as node.

Docker Compose supplies the persistent named volume, localhost port binding, environment file, restart policy, healthcheck, and no-new-privileges setting. CI runs the same functional fake-model smoke flow after building the image.

## Verification and release gates

Every pull request and main push runs typecheck, API-contract drift detection, lint, unit/coverage tests, a production build, Playwright/axe browser tests, a Docker build, a production-container smoke test, and the Compose smoke path.

A successful main push publishes latest and immutable SHA tags to Docker Hub. A version tag must match package.json and can create a GitHub release only after the multi-architecture image publication succeeds. See docs/OPERATIONS.md for operational procedures.

## Deliberate non-goals

The current architecture does not include a visual workflow builder, workflow engine, distributed agent scheduler, agent-per-container deployment, Kubernetes operator, A2A push notifications, extended Agent Cards, non-text A2A parts, message broker, plugin marketplace, or enterprise IAM/RBAC layer. A2A task execution is intentionally in-process and the rate limiter is process-local; use a trusted gateway for horizontally scaled deployments.
