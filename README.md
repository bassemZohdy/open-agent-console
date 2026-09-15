# Open Agent Console

Open Agent Console is a lightweight, self-contained web application for configuring, running, and managing multiple small AI agents from reusable registries.

The project deliberately stays smaller than a workflow/orchestration platform: one application, one Docker image, one SQLite database, and logically instantiated agents running in the same Node.js process.

## Current bootstrap scope

The first vertical slice implements:

- Model Registry for OpenAI and OpenAI-compatible endpoints
- Agent Registry with model selection and instructions
- LangChain JS agent runtime
- Streaming agent chat using Server-Sent Events
- Persistent sessions, messages, and run history
- React control panel
- SQLite persistence through Drizzle and Node `node:sqlite`
- Single production Docker image
- Basic health/readiness endpoints
- CI for typecheck, lint, tests, application build, and Docker build

Tools, reusable skills, long-term memory connectors, and additional model providers are intentionally staged in [`TODO.md`](TODO.md) rather than being mixed into the initial vertical slice.

## Architecture

```text
Browser / React control panel
          |
          v
    Fastify REST + SSE
          |
          +---- Model Registry
          |
          +---- Agent Registry
          |
          +---- Sessions / Runs
          |
          v
 AgentRuntimeManager
          |
          v
 LangChain createAgent()
          |
          v
      Chat model
          |
          v
 OpenAI-compatible endpoint

          +
        SQLite
```

Agents are configuration-driven logical runtime instances. Open Agent Console does **not** start a process or Docker container per agent.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the architectural boundaries and decisions.

## Requirements

- Node.js 24+
- npm
- Docker is optional for local development and recommended for the packaged deployment

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite development server proxies `/api` requests to Fastify on port `3000`.

Before committing changes run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Run with Docker

Create `.env` first and add the credentials referenced by your model records, then:

```bash
docker build -t open-agent-console .

docker run --rm \
  -p 3000:3000 \
  --env-file .env \
  -v open-agent-console-data:/data \
  open-agent-console
```

Open:

```text
http://localhost:3000
```

The production container serves both the API and compiled React application. Persistent state is stored at `/data/open-agent-console.db` by default.

Docker Compose is also available:

```bash
cp .env.example .env
docker compose up --build
```

## First agent

### 1. Configure a credential

Secrets are not stored in Model Registry rows. A model references the name of an environment variable.

For example:

```dotenv
OPENAI_API_KEY=your-key
```

For another OpenAI-compatible provider you can define a separate variable:

```dotenv
CUSTOM_LLM_API_KEY=your-key
```

### 2. Register a model

Open **Models** and provide:

- display name
- provider: `OpenAI` or `OpenAI compatible`
- model identifier
- optional custom base URL
- API-key environment-variable name

### 3. Create an agent

Open **Agents**, choose the registered model, and provide the agent instructions.

### 4. Chat

Select **Chat** next to the agent. Responses stream into the control panel, while the session, messages, and run status are persisted in SQLite.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Fastify port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_FILE_NAME` | `./data/open-agent-console.db` | SQLite database path |
| `OPENAI_API_KEY` | unset | Example credential referenced by a model |

Additional model credentials can use any uppercase environment-variable name configured in the Model Registry.

## API surface

The bootstrap exposes these main endpoints:

```text
GET  /api/health
GET  /api/ready
GET  /api/models
POST /api/models
GET  /api/agents
POST /api/agents
POST /api/agents/:id/chat
GET  /api/sessions
GET  /api/sessions/:id/messages
GET  /api/runs
```

`POST /api/agents/:id/chat` streams events using `text/event-stream`.

## Project structure

```text
src/
├── server/
│   ├── db/
│   ├── domain/
│   ├── runtime/
│   ├── app.ts
│   └── index.ts
└── web/
    ├── App.tsx
    ├── main.tsx
    └── styles.css

tests/
ARCHITECTURE.md
TODO.md
Dockerfile
```

## Current model support

The bootstrap currently uses LangChain `ChatOpenAI` for:

- OpenAI
- services exposing an OpenAI-compatible endpoint through a configurable base URL

Anthropic, Gemini, and Ollama provider-specific adapters are planned after the initial vertical slice is stable.

## Deliberate non-goals for v1

Open Agent Console is not intended to become a workflow engine or distributed agent control plane.

The following are explicitly outside the v1 boundary:

- visual workflow designer
- distributed agent runtime
- agent-per-container execution
- Kubernetes operator
- multi-agent orchestration
- A2A protocol
- message broker
- enterprise RBAC/SSO
- arbitrary JavaScript execution from the UI
- plugin marketplace

## Roadmap

The working backlog is maintained in [`TODO.md`](TODO.md). The next major areas are persistence hardening, provider adapters, full agent lifecycle operations, session UX, reusable skills, safe tools/MCP integration, and long-term memory connectors.

## License

MIT — see [`LICENSE`](LICENSE).
