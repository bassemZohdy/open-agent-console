# Backlog

This file contains the remaining work after the M10–M12 hardening pass. The
product boundary remains one TypeScript modular monolith, one Node.js process,
one SQLite database and one production Docker image. Agents remain logical
in-process runtimes.

## Remaining work

- [ ] **OAC-0104 · P0 · Finish MCP network pinning**
  - HTTP tools now resolve public addresses, pin the connection, reject
    redirects and enforce bounded timeouts/output. MCP discovery/runtime still
    uses the upstream adapter transport, so it needs an adapter-level pinned
    dispatcher before this task is complete.
  - Add regression coverage for redirects, timeouts, response limits and DNS
    rebinding across HTTP and MCP transports.

- [ ] **OAC-0113 · P1 · Split oversized server and UI modules**
  - Decompose `src/server/app.ts` and `src/web/App.tsx` into route/page
    modules, shared typed clients and application services.
  - Complete dependency injection for repositories, runtime managers and test
    databases without changing the established control-panel design language.

- [ ] **OAC-0114 · P1 · Add browser and accessibility coverage**
  - Add browser-level critical paths for create, chat, cancel, session reopen,
    run inspection and import/export.
  - Add automated accessibility and keyboard checks for navigation, pickers,
    dialogs, forms and the chat drawer. The current v8 coverage gate and API
    regression suite are the baseline for this work.

- [ ] **OAC-0123 · P2 · Make release publication fully gated**
  - Require the multi-architecture image digest and release verification to
    complete before creating the GitHub release.
  - Attach migration notes, rollback guidance and published image digests;
    pin GitHub Actions to immutable revisions.

- [ ] **OAC-0124 · P2 · Generate and check API reference**
  - Generate a checked API/SSE reference from the request/response schemas and
    fail CI when the checked reference drifts.

## Completed in this pass

- Runtime dependency cache invalidation and deterministic concurrent refresh.
- Atomic deterministic registry import with rollback, created/updated counts,
  preserved timestamps and regression coverage.
- Bounded memory/history/prompt context with run-level truncation metadata.
- Secret-like outbound values require environment references; HTTP targets are
  restricted to validated public addresses with pinned connections.
- Stable REST/SSE error envelopes with codes and correlation IDs.
- Run detail/tool-call inspection, session rename/delete, filtering and
  pagination metadata, plus control-panel UI states for those flows.
- v8 coverage thresholds, CI container smoke/restart checks, multi-architecture
  image metadata/SBOM/provenance, package-driven version reporting and operator
  security/backup documentation.
