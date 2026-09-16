# UX contract

## Scope

Open Agent Console is a single-user local control panel for a modular Node.js runtime. There is no authentication or role model in this product boundary; deployment access control remains the operator's responsibility.

## Navigation

The primary shell exposes Dashboard, Models, Agents, Skills, Tools, MCP servers, Memory, Sessions, Runs and Settings. Navigation is client-side state in the current SPA and remains usable at narrow widths as a horizontal strip.

## Registry behavior

- Model, skill, tool, MCP server, memory connector and agent editors use explicit labels, native selects and app-owned validation/error banners.
- Create and update requests are validated by the corresponding Zod domain schema. A successful registry mutation refreshes the visible list.
- Agent skill/tool lists preserve the order shown by the editor. Enabled skills are included in the effective prompt; disabled skills are retained in the registry but ignored by runtime composition.
- Tool configuration validation compiles the declared JSON Schema and checks HTTP/MCP-specific references before persistence. Runtime HTTP calls still enforce DNS, timeout, redirect and output bounds.
- Delete is a hard-delete operation where the API permits it. The UI must state the consequence for agents and history and require an explicit app-owned confirmation. Referenced records are protected with a conflict response.

## Memory behavior

`none` is a valid connector and always presents a read-only empty memory surface. SQLite memory is selected per agent and is edited through the Memory screen. Long-term memory is separate from session history and is not included in registry exports.

## Transfer behavior

Registry export/import is JSON version `1`. Exports contain model/agent/skill/tool/MCP/connector configuration and mapping IDs. API keys, raw header values, other secret values and long-term memories are excluded. Imports upsert matching IDs and return a `202` result with counts.

## Chat behavior

Chat is an app-owned drawer. User messages are submitted through the versioned SSE endpoint; streamed tokens append to the assistant message, usage is displayed when available, and cancellation marks an empty response as cancelled. Markdown is sanitized before rendering.

## Business sources

- `ARCHITECTURE.md` — runtime boundaries, persistence and security.
- `README.md` — operator-facing setup and API surface.
- `src/server/domain/schemas.ts` — accepted registry payloads.
- `src/server/app.ts` — HTTP behavior and response codes.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Table Selection | Ordered picker controls | `src/web/App.tsx` | Checkbox plus up/down buttons | Keyboard and component tests |
| Select/Listbox | Native select | `src/web/App.tsx` | Native browser select | Keyboard and responsive smoke check |
| Form | Field and app-owned banner | `src/web/App.tsx` | Registry-specific fields | Typecheck, API tests and UI component test |
| Scrollbar | Global CSS tokens | `src/web/styles.css` | Reduced-motion and forced-colors fallbacks | Premium UI audit |
| Toast | App-owned status banner | `src/web/App.tsx` | Success and error live regions | UI component test |
| CRUD | Registry list plus editor panel | `src/web/App.tsx` and `src/server/app.ts` | Per-registry fields | API lifecycle tests |
