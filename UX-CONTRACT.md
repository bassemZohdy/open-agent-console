# UX contract

## Product boundary

Open Agent Console is a local control panel for a modular Node.js runtime. When demo accounts are configured, it authenticates users with an HttpOnly session cookie and applies role checks at the API boundary. If no accounts are configured, the legacy `OAC_ROLE` single-role fallback remains available for local automation.

## Navigation

The shell exposes Dashboard and the role-appropriate Settings/configuration tools. Conversations are always listed in the left rail with icons, optional search, a view-all fallback, and a hover/focus delete action protected by the shared confirmation dialog. Execution activity is scoped to the selected conversation and is not a peer destination in the primary navigation. Signed-out visitors remain in the shell with the guest-accessible conversation launcher. On desktop, collapsing the rail produces a 68px icon-only strip with centered controls and accessible hover/focus tooltips; below 720px the shell stays expanded as a horizontally scrollable strip.

## Theme behavior

- Dark is the default theme and preserves the operational flight-deck appearance.
- The global header exposes an accessible light/dark theme toggle as a compact icon button with an explicit accessible name and hover/focus tooltip.
- The selected theme persists locally under `open-agent-console-theme`; switching themes does not reload the route or discard in-progress form/chat state.
- Semantic state colors retain their meaning in both themes and are paired with text labels where state is user-relevant.

## Role and settings behavior

- Sign-in resolves one of three roles: `admin`, `user`, or `guest`; the browser does not choose or override the role.
- Demo accounts are configured with `OAC_ADMIN_USERNAME`/`OAC_ADMIN_PASSWORD`, `OAC_USER_USERNAME`/`OAC_USER_PASSWORD`, and optional guest equivalents. The session cookie is HttpOnly, SameSite=Lax, and never stores credentials in the browser.
- Admins see the Settings and configuration group in the sidebar, including models, agents, skills, tools, MCP servers, memory, and registry transfer.
- Users see operational navigation only: Chat, the conversation rail, and a limited Settings view for workspace access and appearance guidance.
- Signed-out visitors and Guests see Chat, the conversation rail, and the available-agent launcher; their sessions, activity, and chat requests remain filtered to guest-accessible agents. Dashboard is admin-only.
- Signed-out visitors and Guests may delete conversations they can see; the destructive request remains server-scoped to guest-accessible agents and does not require upgrading to an authenticated account.
- Sign-in opens as a modal over the guest workspace and can be dismissed with Escape, the close button, or the backdrop. Successful sign-in returns the user to the same shell with role-appropriate navigation.
- The Chat welcome composer is available in the home surface, uses the selected allowed agent, sends with Enter, and preserves Shift+Enter for a new line. It exposes file attachment and browser voice-input controls; when no agent is available it remains disabled with an explanatory empty state.
- Every agent has an access level: `guest` is available to Guests and Users, `user` is available to Users, and `admin` is available only to Admins.
- Dashboard is not presented to Users or Guests. Admin actions route into Settings so configuration does not appear as an operational Chat home-page action.
- Admin-only configuration and registry-transfer APIs return `403 FORBIDDEN` for User and Guest requests, including direct requests outside the UI.
- A2A exposure management is admin-only and appears inside Settings, never as a primary Chat action. New/edit forms are closed by default and open in the shared dialog; every exposure is draft/private and disabled until an administrator explicitly enables and publishes it.
- A2A statuses are communicated as text plus color: Draft, Published, Paused, and unavailable/misconfigured. The UI shows the safe Agent Card path and limits, while credential values, instructions, memory, and tool configuration remain server-side.
- Agent chat, session history, and run inspection are filtered and protected by the agent access level.
- When no credential accounts are configured, the legacy deployment role is selected with `OAC_ROLE=guest|user|admin`; the default is `admin` for existing local deployments.

## Canonical UI map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Table Selection | Not applicable; registry rows expose direct actions | UX contract | action list / no row selection | keyboard and E2E |
| Select/Listbox | Shared `SearchableSelect` for lists over five; native `select` for five or fewer | DESIGN.md and UX contract | searchable / native | keyboard, filtering, and popup |
| Form | Shared `Field`, `FormHeading`, and page form handlers | UX contract | create / edit | validation and E2E |
| Scrollbar | Global application stylesheet | DESIGN.md and `src/web/styles.css` | global / geometry exception | computed style |
| Toast | Shared page-level `banner` status region | UX contract | success / notice / error | live-region test |
| CRUD | Shared `json` request helper and registry page handlers | UX contract | list/editor split | lifecycle and E2E |
| A2A exposure | Settings-only `A2aExposure` list and shared `FormDialog` | TODO.md / API contract | draft / publish / pause | API/security and browser checks |

## Registry behavior

- Model, skill, tool, MCP server, memory connector, and agent editors use visible labels, native selects, and app-owned validation/error banners.
- Create/update requests are validated by the corresponding Zod schema.
- Successful mutations refresh the visible list and invalidate affected runtime cache entries.
- Disabled records remain visible with explicit disabled text.
- Repeated row actions use shared icon buttons with action-specific accessible names and hover/focus tooltips; visible decisions use the shared compact action-button family with consistent leading icons, while add, save, and other primary decisions remain discoverable in context.
- Agent skill/tool mappings preserve their displayed order and provide keyboard-operable up/down controls.
- The effective prompt is read-only and clearly labeled.
- Delete is a hard-delete operation where the API permits it. Conversation deletion removes messages and run history, resets an open conversation to the chat welcome state, and requires app-owned confirmation. The server also scopes direct session rename, read, and delete operations to sessions whose agents are visible to the current role.
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

Chat is the default full-application workspace for Guest and User roles, with a persistent left rail for new chats and conversation history. Admins may also use the same workspace; the Dashboard is an admin-only operational overview. The thread viewport and composer interaction layer use `@assistant-ui/react` through an external-store adapter, while the versioned SSE endpoint, session/run persistence, role filtering, and message rendering remain app-owned. Enter submits the message, while Shift+Enter preserves a new line; IME composition always wins over the shortcut. The composer keeps focus after send, grows for longer prompts within a bounded height, and exposes the shortcut in helper text. Up to five files (8 MB each) can be attached; the related user message displays safe file metadata after send and after session reopen, while text-like files are bounded to 60,000 characters and stored with the message for current and subsequent model turns. Original binary files are not uploaded or recoverable. Voice input uses browser speech recognition and never sends audio unless the user submits the resulting text. Token events append to the assistant response; usage is shown when available; cancellation produces a cancelled run; errors show a bounded message and correlation ID. Markdown is sanitized before rendering.

Conversation history is reopened from the left rail or the view-all conversations screen. Activity is loaded by conversation and shows execution status, usage, failures, and bounded context details inline with the chat. The API retains independent session/run records for operational inspection and filtering.

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
