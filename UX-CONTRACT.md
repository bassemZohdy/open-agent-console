# UX contract

## Product boundary

Open Agent Console is a single-user local control panel for a modular Node.js runtime. It has no authentication, authorization, tenant, or role model. Deployment access control belongs to the operator and the reverse proxy.

## Navigation

The shell exposes Dashboard, Models, Agents, Skills, Tools, MCP servers, Memory, Sessions, Runs, and Settings. Navigation is client-side state in the current SPA. The desktop rail becomes a horizontally scrollable strip below 720px.

## Registry behavior

- Model, skill, tool, MCP server, memory connector, and agent editors use visible labels, native selects, and app-owned validation/error banners.
- Create/update requests are validated by the corresponding Zod schema.
- Successful mutations refresh the visible list and invalidate affected runtime cache entries.
- Disabled records remain visible with explicit disabled text.
- Agent skill/tool mappings preserve their displayed order and provide keyboard-operable up/down controls.
- The effective prompt is read-only and clearly labeled.
- Delete is a hard-delete operation where the API permits it. The UI states the consequence and requires app-owned confirmation.
- Referenced records return a conflict response rather than silently breaking an agent.

## Agent composition

An agent combines:

1. one enabled model;
2. its instructions;
3. enabled skills in explicit order;
4. enabled tools in explicit order; and
5. an optional memory connector.

The editor exposes model/tool-call limits and lets the operator inspect the composed prompt before opening Chat.

## Memory behavior

The none connector is valid and always presents an empty read-only memory surface. SQLite memory is selected per agent and edited through Memory. Long-term memory is separate from session history and is not included in registry exports.

## Tool and MCP behavior

Tool configuration is validated before persistence. HTTP and MCP targets must pass public-address checks and use bounded execution. Credentials are referenced through environment variables. The UI must never ask the operator to paste a secret into a registry record.

## Transfer behavior

Registry export/import uses JSON version 1. Exports contain model, agent, skill, tool, MCP, connector, and mapping configuration. API keys, raw header secrets, long-term memories, sessions, messages, runs, and tool calls are excluded. Imports upsert matching IDs and report created/updated counts.

## Chat behavior

Chat is an app-owned drawer. The user message is submitted to the versioned SSE endpoint. Token events append to the assistant response; usage is shown when available; cancellation produces a cancelled run; errors show a bounded message and correlation ID. Markdown is sanitized before rendering.

Session history can be reopened from Sessions. Runs can be filtered and inspected independently, including context truncation and persisted tool-call status.

## Accessibility requirements

- All controls have a visible label or an explicit accessible name.
- Keyboard navigation works for the shell, ordered mappings, forms, dialogs, and chat.
- Status/error banners use live-region semantics.
- Destructive confirmation uses dialog semantics and an explicit Cancel action.
- Color is paired with text such as enabled, failed, disabled, loading, or cancelled.
- Reduced-motion and forced-colors fallbacks remain enabled.

## Source of truth

| Concern | Canonical source |
| --- | --- |
| API payloads and limits | src/server/domain/schemas.ts |
| HTTP behavior and status codes | src/server/app.ts |
| Runtime and persistence | ARCHITECTURE.md |
| Visual tokens/responsive rules | DESIGN.md and src/web/styles.css |
| API contract | docs/api-reference.json |
| Operator setup | README.md and docs/OPERATIONS.md |

## Verification map

| Capability | Verification |
| --- | --- |
| Registry CRUD and conflict rules | API lifecycle tests |
| Prompt composition and memory bounds | Runtime tests |
| Chat streaming/cancellation | SSE and integration tests |
| Keyboard navigation and critical workflows | Playwright tests |
| Automated accessibility | axe-core browser test |
| Deployment and persistence | Docker/Compose smoke tests |
