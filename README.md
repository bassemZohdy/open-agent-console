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
- Single production Docker image with healthcheck and persistent `/data` volume

Skills, tools/MCP and long-term memory are intentionally separate follow-up registries; see `TODO.md`.

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
LangChain createAgent()
      |
      +--> OpenAI / OpenAI-compatible
      +--> Anthropic
      +--> Google Gemini
      +--> Ollama
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

## Local development

Requirements:

- Node.js 24+
- npm

```bash
npm install
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

An agent references a registered model and stores its instructions and generation/runtime limits. Updating its configuration invalidates its cached runtime automatically. Disabling an agent prevents new runs without deleting its configuration.

Deleting an agent also removes its associated sessions/messages/runs through SQLite foreign-key cascades. Deleting a model is blocked while an agent still references it.

## Sessions and runs

Chat history belongs to Open Agent Console rather than an external LLM framework checkpoint store. Existing sessions can be reopened from the Sessions page and continue with their saved message history.

Runs record status, errors, correlation IDs, and token usage when the selected provider returns usage metadata.

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
- assistant Markdown does not enable raw HTML and is sanitized
- arbitrary JavaScript execution from the UI is not supported

HTTP/MCP tools are not enabled until their dedicated security boundaries are implemented.

## Non-goals

The current project does **not** aim to be a visual workflow builder, distributed agent runtime, agent-per-container platform, Kubernetes operator, A2A platform, message-broker-based system or enterprise IAM product.

## Roadmap

The active backlog is maintained in [TODO.md](TODO.md). Completed work is removed from that file so it represents only outstanding tasks.

## License

MIT — see [LICENSE](LICENSE).
