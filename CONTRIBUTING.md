# Contributing

## Local development

1. Use Node.js 24 or newer.
2. Copy `.env.example` to `.env` and configure only the credentials you need.
3. Run `npm ci`.
4. Run `npm run dev`.
5. Open `http://localhost:5173` during development.

Before submitting changes run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
docker build -t open-agent-console:ci .
```

When changing dependencies, run `npm install` deliberately, review the dependency diff, and commit the updated `package-lock.json`. CI uses `npm ci` and does not mutate the lockfile.

## Database and migrations

The application applies Drizzle migrations automatically on startup. Do not edit an already-applied migration; add a new timestamped migration and verify it against both a fresh database and an existing `/data/open-agent-console.db`.

The default database path is `./data/open-agent-console.db` locally and `/data/open-agent-console.db` in the production container. Keep persistent application data under `/data` in Docker.

## Runtime and security boundaries

Agents are logical in-process runtimes. Do not add an agent-specific process or container. Model credentials remain environment-variable references. Do not add arbitrary JavaScript tools. Changes to HTTP or MCP tools must preserve URL validation, timeout, output-size, credential-resolution and redirect protections.

## Pull requests

Use a dedicated branch and keep commits cohesive. Before opening a pull request, confirm the working tree is clean, all checks pass, documentation reflects the implementation, and migrations are included for schema changes. Never force-push, bypass branch protections or merge failing/unverified changes.

Keep the architecture deliberately small. New distributed infrastructure, workflow engines, arbitrary code execution, or agent-per-container behavior require an explicit architectural decision before implementation.
