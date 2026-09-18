# Contributing

## Before you start

Open Agent Console is intentionally a small modular monolith. Keep agents as logical in-process runtimes and preserve the single Node.js process, SQLite database, and production image unless an architectural decision explicitly changes that boundary.

Use Node.js 24 or newer.

    cp .env.example .env
    npm ci
    npm run dev

The UI runs at http://127.0.0.1:5173. Local data is written to ./data/open-agent-console.db.

## Required verification

Run the narrowest relevant checks while developing, then run the complete gate before opening a pull request:

    npm run typecheck
    npm run api:check
    npm run lint
    npm test
    npm run test:coverage
    npm run build
    npx playwright install chromium
    npm run test:e2e
    docker build -t open-agent-console:ci .
    npm run smoke:compose

The Compose smoke command requires Docker and jq. CI runs the same functional fake-model path after the production-container smoke test.

## Documentation expectations

Update the documentation in the same change as the implementation:

- README.md for user/operator behavior, configuration, or commands;
- ARCHITECTURE.md for runtime boundaries, persistence, security, or lifecycle;
- docs/API.md and docs/api-reference.json for API behavior;
- docs/OPERATIONS.md and docs/MIGRATIONS.md for deployment/data changes;
- DESIGN.md and UX-CONTRACT.md for UI behavior, accessibility, or visual tokens; and
- TODO.md only for genuinely outstanding work.

Do not leave completed checkboxes in TODO.md. Git history and release notes provide the historical record.

## Database and migrations

The application applies Drizzle migrations automatically at startup. Never edit a migration that may already have been applied. Add a new timestamped migration and verify it against:

1. a fresh database; and
2. an existing database containing representative registry and history data.

Keep persistent Docker data under /data. Do not delete a volume as part of a normal upgrade.

## API and runtime boundaries

Validate request payloads with the existing Zod schemas and preserve the structured error envelope and correlation IDs. Keep provider-specific code in the model factory, persistence in the repository, tool behavior in the tool resolver, and memory behavior behind the connector interface.

Changes to HTTP/MCP tools must preserve public-address validation, pinned connections, timeout/output bounds, redirect protections, environment-backed credentials, and JSON Schema validation.

## Tests

Prefer deterministic tests that use the fake provider or injected database/repository seams. Add:

- route tests for new API behavior;
- runtime tests for prompt, cache, limit, cancellation, or tool behavior;
- browser/axe coverage for critical user flows; and
- migration/acceptance coverage when deployment behavior changes.

Avoid tests that depend on a real provider, public network, or an existing local database.

## Pull requests

Use a dedicated branch and cohesive commits. Include:

- a concise problem statement;
- the implementation and test evidence;
- migration and rollback notes when data changes;
- documentation updates; and
- any intentional product-boundary change.

Before requesting review, confirm that the working tree is clean and that the complete verification gate passes. Do not force-push, bypass branch protections, or merge failing/unverified changes.
