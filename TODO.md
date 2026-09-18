# Backlog

There are no open backlog items in this release.

All previously tracked work has been implemented, documented, merged to main, and verified by CI. The current product remains a TypeScript modular monolith: one Node.js process, one SQLite database, one production Docker image, and logical in-process agents.

## Completed release scope

The completed scope includes:

- provider/model registry and model connection testing;
- agent lifecycle, runtime caching, bounded execution, sessions, chat streaming, cancellation, usage, and run history;
- skills, ordered mappings, effective-prompt preview, tools, MCP discovery, memory connectors, and long-term memory;
- secure HTTP/MCP resolution with public DNS checks, pinned connections, redirect rejection, credential indirection, and bounded output;
- registry import/export with deterministic updates and secret/memory exclusion;
- API error envelopes, correlation IDs, pagination, filtering, and generated API reference;
- SQLite migrations, Docker health/readiness, non-root runtime, container smoke tests, and Docker Compose acceptance;
- Playwright critical-path coverage and axe accessibility checks; and
- gated multi-architecture Docker publication and release notes.

## Adding future work

When a new requirement is identified, add it here before implementation. Each item should include:

1. a stable identifier such as OAC-0130;
2. priority and a short outcome;
3. acceptance criteria that can be tested;
4. documentation and migration impact; and
5. whether it changes the deliberate product boundary.

Remove an item after implementation only when its tests, documentation, and CI evidence are complete. Do not use this file as a historical changelog; use Git history and release notes for completed work.
