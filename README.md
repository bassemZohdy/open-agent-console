# Open Agent Console

Open Agent Console is a lightweight, self-contained web application for configuring, running and managing multiple AI agents from reusable registries.

The product deliberately stays simple: **one application, one Docker image, one SQLite database, and many logical agents running inside the same Node.js process.**

## What works today

- Model registry with OpenAI, OpenAI-compatible, Anthropic, Google Gemini and Ollama adapters
- Model connection testing, capabilities metadata, retry and timeout configuration
- Agent registry with create/edit/duplicate/enable-disable/delete operations
- Agent instructions plus temperature, max-token and execution-limit controls
- In-process prepared-agent cache with deterministic invalidation
- Streaming agent chat over versioned Server-Sent Events
- Persistent sessions/messages with reopening of previous conversations
- Response cancellation
- Provider token-usage persistence where available
- Safe Markdown rendering for assistant responses
- Paginated session and run APIs
- Correlation IDs and recent-error visibility
- SQLite persistence with versioned Drizzle migrations
- Skills registry CRUD, ordered agent mappings and effective-prompt preview
- Tools registry CRUD with JSON Schema validation, bounded HTTP actions and MCP server discovery
- Memory connector and long-term-memory CRUD, including `none` and SQLite runtimes
- Settings surface plus versioned registry import/export that excludes secrets and memories
- Deterministic fake chat model for CI and a local OpenAI-compatible integration fixture
- Frontend component coverage for the management shell
- Versioned GitHub release workflow triggered by `v*.*.*` tags
- Deterministic effective prompts from agent instructions, enabled skills and long-term memory
- Safe built-in calculator/date tools plus bounded HTTP and MCP resolver foundations
- Tool-call persistence for runtime-resolved tools
- Single production Docker image with healthcheck and persistent `/data` volume

The control panel exposes all current registry/runtime surfaces. See `DESIGN.md` for the UI language and `UX-CONTRACT.md` for interaction behavior.

## Architecture

```text
Browser / React
      |
      v
Fastify REST + SSE
      |
      +--> Registries / Sessions / Runs --> SQLite
      |
      v
AgentRuntimeManager
      |
      v
Resolve model + skills + tools + memory
      |
      v
LangChain createAgent()
      |
      +--> OpenAI / OpenAI-compatible / Anthropic / Google / Ollama
      +--> Built-in calculator and date tools
      +--> Bounded HTTP and MCP tool resolvers
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for lifecycle, persistence and security details.

## Quick start with Docker

```bash
docker build -t open-agent-console .

docker run --rm \
  -p 3000:3000 \
  -v open-agent-console-data:/data \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  open-agent-console
```

Open `http://localhost:3000`.

The application stores its SQLite database at `/data/open-agent-console.db` by default and applies versioned migrations automatically on startup.

## Docker Hub CI publishing

Pull requests and pushes to `main` run the typecheck, lint, test, build and Docker verification steps. A successful push to `main` also publishes:

```text
docker.io/<DOCKERHUB_USERNAME>/open-agent-console:latest
docker.io/<DOCKERHUB_USERNAME>/open-agent-console:sha-<commit>
```

Configure the Docker Hub token as a GitHub Actions repository secret before merging to `main`:

- `DOCKERHUB_TOKEN`: a Docker Hub access token with permission to push to the repository

The workflow uses the `bzohdy` Docker Hub account for this repository by default. Set `DOCKERHUB_USERNAME` when publishing under another account or organization. Common aliases `DOCKER_USERNAME` and `DOCKERHUB_USER` are also accepted.

The image is built and published by GitHub Actions only after the verification job passes.

## Local development

Requirements:

- Node.js 24+
- npm

```bash
npm ci
npm run dev
```

The Vite development server proxies API calls to Fastify.

Useful checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
docker build -t open-agent-console .
```

`npm ci` is the reproducible install used by CI and the Docker build. Use `npm install` only when intentionally changing dependencies and then commit the resulting `package-lock.json`.

## Model configuration

A model record stores configuration, not the secret itself. `apiKeyEnv` points to an environment variable available to the Open Agent Console process.

Examples:

| Provider | Example model ID | Credential reference | Base URL |
| --- | --- | --- | --- |
| OpenAI | provider-specific | `OPENAI_API_KEY` | optional |
| OpenAI-compatible | provider-specific | e.g. `OPENROUTER_API_KEY` | required |
| Anthropic | provider-specific | `ANTHROPIC_API_KEY` | optional |
| Google Gemini | provider-specific | `GOOGLE_API_KEY` | optional |
| Ollama | local model name | none required | optional |

Use the **Test** action in the Models page to validate the configured provider/model from the running server.

## Agent lifecycle

An agent references a registered model and stores its instructions, optional skill/tool/memory references, and generation/runtime limits. At runtime, the manager resolves the selected model, ordered enabled skills, enabled tools and memory connector before constructing a LangChain agent. Updating its configuration invalidates its cached runtime automatically. Disabling an agent prevents new runs without deleting its configuration.

Deleting an agent also removes its associated sessions/messages/runs through SQLite foreign-key cascades. Deleting a model is blocked while an agent still references it.

The control panel exposes model, agent, skill, tool, MCP server and memory management. Effective prompts can be inspected from the agent editor before a run.

## Sessions and runs

Chat history belongs to Open Agent Console rather than an external LLM framework checkpoint store. Existing sessions can be reopened from the Sessions page and continue with their saved message history.

Runs record status, errors, correlation IDs, and token usage when the selected provider returns usage metadata. Runtime-resolved tool calls are persisted separately with their status, input, bounded output and failure details.

## API surface

The currently exposed API includes:

| Area | Endpoints |
| --- | --- |
| Health | `GET /api/health`, `GET /api/ready` |
| Models | `GET/POST /api/models`, `PUT/DELETE /api/models/:id`, `POST /api/models/:id/test` |
| Agents | `GET/POST /api/agents`, `PUT/DELETE /api/agents/:id`, `PATCH /api/agents/:id/enabled`, `POST /api/agents/:id/duplicate` |
| Chat | `POST /api/agents/:id/chat` using Server-Sent Events |
| Sessions | `GET /api/sessions`, `GET /api/sessions/:id/messages` |
| Runs | `GET /api/runs` |

All registry tables are available through validated HTTP APIs and the control panel.

## API health

```text
GET /api/health
GET /api/ready
```

`/api/ready` verifies that SQLite is queryable. The Docker healthcheck uses `/api/health`.

## Security baseline

- secrets stay in environment variables
- request payloads are validated with Zod
- request body size is limited
- model timeouts/retries are bounded
- model/tool call counts are bounded per run
- HTTP tool URLs require HTTP(S), reject embedded credentials and reject DNS results in private/restricted ranges
- HTTP tool requests have bounded timeouts/output and do not follow redirects
- MCP header credentials can be referenced through environment variables
- assistant Markdown does not enable raw HTML and is sanitized
- arbitrary JavaScript execution from the UI is not supported

HTTP/MCP tools are configurable from the control panel. Runtime exposure remains subject to JSON Schema validation, public DNS checks, bounded timeouts/output, redirect rejection and environment-backed headers.

## Non-goals

The current project does **not** aim to be a visual workflow builder, distributed agent runtime, agent-per-container platform, Kubernetes operator, A2A platform, message-broker-based system or enterprise IAM product.

## Roadmap

The active backlog is maintained in [TODO.md](TODO.md). Completed work is removed from that file so it represents only outstanding tasks.

The next product step is a new scoped milestone; this release closes the M5–M9 backlog.

## License

MIT — see [LICENSE](LICENSE).
