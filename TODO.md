# Backlog

The current product boundary is admin-managed Agent-to-Agent (A2A) exposure. The first transport slice is deliberately narrow: A2A v1.0 HTTP+JSON, optional SSE streaming, text input/output, bearer or public access, durable task state, and admin-controlled publication. Internal UI roles (`admin`, `user`, and `guest`) are never reused as external A2A caller credentials.

The A2A plan is phased:

1. define the protocol/version, public Agent Card boundary, identity model, task mapping, and threat controls;
2. add an exposure registry and admin control plane, draft/private and disabled by default;
3. implement standards-conformant discovery and transport with explicit task lifecycle and streaming/polling behavior;
4. add authentication, authorization, quotas, auditability, observability, and operational controls;
5. add admin UX, documentation, migration evidence, conformance tests, and a staged rollout.

## Active A2A work

### OAC-0130 - A2A boundary and security contract

- Status: `complete`
- Priority/outcome: P0; make the externally visible contract safe and versioned before network publication.
- Protocol target: A2A v1.0 HTTP+JSON binding with SSE task updates where enabled.
- Acceptance evidence:
  - selected version and binding are recorded in `ARCHITECTURE.md`, `docs/API.md`, and `docs/api-reference.json`;
  - Agent Cards contain only publishable identity, capabilities, auth requirements, and skills; never instructions, credentials, memory configuration, or internal tool details;
  - external caller identity/authentication is separate from console UI roles;
  - publication is opt-in, disabled by default, and reversible with `enabled: false` or `published: false`;
  - task, message, artifact, context, correlation, and cancellation mapping is documented;
  - unsupported push notifications, extended cards, and non-text input/output are explicitly advertised or rejected.
- Documentation/migration impact: architecture, API, security/operations guidance, README, and migration ledger updated.
- Product boundary: yes; this is a controlled external integration boundary inside the modular monolith.

### OAC-0131 - A2A exposure registry and admin control plane

- Status: `complete`
- Delivered slice: registry, repository methods, admin-only CRUD, publication/pause controls, validation, migration, generated API contract, and API/security tests.
- Acceptance evidence:
  - every exposure belongs to exactly one agent and has a unique validated slug;
  - new exposures are draft/private and disabled by default;
  - configuration stores only an environment-variable name for bearer credentials, never a raw secret;
  - only `admin` can list or mutate exposure configuration;
  - deleting an agent cascades exposure configuration and tasks;
  - API responses omit secrets and internal agent instructions.
- Documentation/migration impact: SQLite migration, repository contract, API reference, migration/rollback notes.
- Product boundary: yes; publication is an explicit admin action.

### OAC-0132 - Agent Card and discovery

- Status: `complete`
- Priority/outcome: P0; expose a versioned, least-privilege Agent Card only for explicitly published exposures.
- Acceptance evidence:
  - published exposures provide `GET /a2a/{slug}/.well-known/agent-card.json`;
  - unpublished, disabled, unavailable, or unauthorized exposures do not leak cards;
  - cards advertise capabilities, skills, auth requirements, and protocol versions without sensitive configuration;
  - card responses use `application/a2a+json`, correlation headers, and authenticated discovery for private/internal exposures.
- Documentation/migration impact: API reference, security guidance, deployment routing, and tests.
- Product boundary: yes; this is the first externally discoverable surface.

### OAC-0133 - A2A transport and task lifecycle

- Status: `complete`
- Priority/outcome: P0; translate A2A messages into the existing runtime while preserving task state, context, artifacts, streaming, polling, and cancellation semantics.
- Acceptance evidence:
  - send, get, list, cancel, and SSE subscribe routes are implemented;
  - task/context IDs are durable and map to sessions/runs with correlation IDs;
  - streaming and polling are bounded, resumable through task reads/subscriptions, and safe on client disconnect;
  - duplicate message delivery is idempotent and caller-bound;
  - protocol errors never expose internal prompts, tool credentials, or stack traces.
- Documentation/migration impact: task storage migration, API reference, runbook, and interoperability examples.
- Product boundary: yes; push notifications are not advertised or implemented.

### OAC-0134 - A2A identity, quotas, audit, and operations

- Status: `complete`
- Priority/outcome: P0; make external access governable in production.
- Acceptance evidence:
  - bearer/public transport authentication is validated independently of UI login sessions;
  - per-exposure authorization, rate limits, task timeouts, payload limits, and concurrency limits are enforced;
  - admin changes and external task events are audited without logging secrets or message content by default;
  - disabling an exposure takes effect without restart;
  - emergency rotation and rollback guidance is documented.
- Documentation/migration impact: `docs/OPERATIONS.md` and migration `20260920030000_a2a_transport`.
- Product boundary: no new user-facing role; this hardens the external integration boundary.

### OAC-0135 - Admin UX for managed exposure

- Status: `complete`
- Priority/outcome: P1; make exposure state understandable and difficult to misconfigure.
- Acceptance evidence:
  - admin-only Settings provides create/edit/delete controls in a closed-by-default dialog;
  - draft, published, paused, unavailable, and misconfigured states are visually distinct;
  - the UI shows the safe Agent Card route and endpoint/auth requirements without revealing secrets;
  - publication is explicit and explains the exposure boundary;
  - non-admin users never see management controls or hidden configuration fields.
- Documentation/migration impact: `DESIGN.md` and `UX-CONTRACT.md` define the settings-only workflow and shared dialog/select owners.
- Product boundary: no new boundary.

### OAC-0136 - Verification, rollout, and completion evidence

- Status: `complete`
- Priority/outcome: P0; ship only with repeatable evidence and a reversible rollout.
- Acceptance criteria:
  - unit, API, security, migration, accessibility, and end-to-end tests cover the completed slices;
  - API docs are generated and checked in CI;
  - a disabled-by-default deployment can upgrade and roll back safely;
  - a canary procedure, compatibility matrix, and failure-mode runbook are documented;
  - close this item only after full tests, docs, lint/build, migration, and browser evidence pass.
- Documentation/migration impact: release notes, migration ledger, CI checks, and operational runbook.
- Product boundary: no.

- Verification evidence:
  - 27 unit/integration tests passed across 13 test files;
  - A2A API, security, idempotency, streaming, task lifecycle, and cascade-delete tests passed;
  - Playwright critical paths passed, including axe accessibility checks and the create/chat/reopen/export journey;
  - typecheck, lint, generated API reference check, production build, and diff checks passed;
- Docker Compose was restored and `/api/ready` returned `ready` after the final build.

### OAC-0137 - Durable chat attachment references

- Status: `complete`
- Priority/outcome: P1; preserve attachment provenance and context across the conversation lifecycle.
- Acceptance evidence:
  - user messages persist bounded attachment metadata and extracted text in SQLite;
  - session message reads return safe attachment summaries without returning stored text or binary data;
  - reopened conversations render the attachment on the related user message;
  - later turns reuse stored extracted text without requiring the file to be uploaded again;
  - migration, API documentation, architecture notes, and regression coverage are updated.
- Product boundary: original binary files are intentionally not uploaded or recoverable.

## Implementation order

Implementation and final verification are complete through OAC-0136. The transport is intentionally limited to published exposures and does not claim push notifications, extended cards, non-text parts, enterprise IAM, or distributed task workers.

All previously tracked work is implemented, documented, and verified as a TypeScript modular monolith: one Node.js process, one SQLite database, one production Docker image, and logical in-process agents.

## Completed release scope

The completed scope includes:

- provider/model registry and model connection testing;
- agent lifecycle, runtime caching, bounded execution, sessions, chat streaming, cancellation, usage, and run history;
- skills, ordered mappings, effective-prompt preview, tools, MCP discovery, memory connectors, and long-term memory;
- secure HTTP/MCP resolution with public DNS checks, pinned connections, redirect rejection, credential indirection, and bounded output;
- registry import/export with deterministic updates and secret/memory exclusion;
- API error envelopes, correlation IDs, pagination, filtering, and generated API reference;
- admin-managed A2A Agent Cards, HTTP+JSON task transport, SSE updates, polling, cancellation, caller-bound idempotency, quotas, and audit events;
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
