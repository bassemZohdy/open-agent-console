# Backlog

This file contains the remaining work after the M10–M12 hardening pass. The
product boundary remains one TypeScript modular monolith, one Node.js process,
one SQLite database and one production Docker image. Agents remain logical
in-process runtimes.

## Remaining work

- [x] **OAC-0104 · P0 · Finish MCP network pinning**
  - HTTP and MCP tools resolve public addresses, pin the connection through a
    custom MCP SDK fetch, reject origin-changing redirects and enforce bounded
    timeouts/output with bounded reconnects.
  - Regression coverage covers redirect rejection, origin pinning and streamed
    response limits; public DNS validation remains shared by both transports.

- [x] **OAC-0113 · P1 · Split oversized server and UI modules**
  - Added an application dependency boundary for repositories, runtime managers
    and SQLite connections, plus the generated typed API contract boundary.
  - Existing route/page components retain the established control-panel design
    language; further visual decomposition can proceed behind these seams.

- [x] **OAC-0114 · P1 · Add browser and accessibility coverage**
  - Playwright covers create, chat, session reopen, run inspection and
    import/export; axe-core covers the navigation page and keyboard activation.
  - The v8 coverage gate and API regression suite remain required CI baselines.

- [x] **OAC-0123 · P2 · Make release publication fully gated**
  - GitHub releases now require the verified tag and successful multi-architecture
    image publication, then include the immutable digest and operator guidance.
  - GitHub Actions are pinned to immutable revisions and container smoke tests
    prepare the bind-mounted database directory for the non-root image user.

- [x] **OAC-0124 · P2 · Generate and check API reference**
  - `docs/api-reference.json` is generated from the Zod request schemas and
    checked in CI with `npm run api:check`; drift fails verification.

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
