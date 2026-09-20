---
name: Open Agent Console
version: 0.4.0
purpose: Local control panel for configuring and running bounded AI agents
---

# Design context

Open Agent Console is an operational flight deck for assembling small agent crews. It should feel calm, instrumented, local, and trustworthy: the operator should always know what is configured, what will execute, and what happened.

## Visual language

| Role | Token |
| --- | --- |
| Canvas | #071014 |
| Surface | #0e1b20 and #13252b |
| Surface interaction | #17343a |
| Primary signal | #49d3d0 |
| Secondary signal | #2b6d73 |
| Attention | #f6b95b |
| Success | #6ed9a7 |
| Danger | #f2839b |
| Body text | #e8eef3 |
| Muted text | #8ea4a8 |

Use quiet blue-green borders instead of white cards. Use restrained shadows and subtle gradients for elevation. The operational UI uses a system sans stack; IDs, JSON, prompts, and correlation IDs use a monospace stack.

Panels use a 16px radius and a soft offset shadow (`0 12px 36px rgba(0, 0, 0, .14)`). The interaction surface is reserved for hover and selected affordances; the secondary signal is a lower-intensity border and focus-adjacent accent.

## Theme strategy

Dark is the default operating theme: near-black canvas, blue-green surfaces, and cyan instrument signals keep long sessions calm. Light is an explicit operator choice rather than an automatic inversion: it uses a cool mint-white canvas (`#f3f7f5`), white raised surfaces, deep green ink (`#183034`), and the same cyan signal hierarchy. Semantic meanings stay stable across themes: cyan is action/focus, green is ready/success, amber is attention, and rose is danger.

The theme control lives in the global header, persists under the `open-agent-console-theme` local-storage key, and updates the browser surface color without disturbing page or form state.

## Layout

- The desktop shell uses a compact navigation rail with searchable conversation history and a 12-column mental grid.
- When collapsed, the desktop rail becomes a 68px icon-only strip: brand, New chat, and every permitted destination use centered 40px targets with hover/focus tooltips; conversation history and labels return when expanded. Below 720px the shell stays expanded as a horizontally scrollable strip.
- Registry pages are browse-first; create and edit forms open in focused dialogs.
- Long option lists use a searchable authored select; short lists keep native selects.
- Below 720px, navigation becomes a horizontally scrollable strip.
- Chat is the default full-application workspace for Guest and User roles: a persistent left rail, recent conversations, an agent-aware composer, and a calm welcome state. Signed-out visitors keep this workspace visible instead of landing on a separate sign-in page.
- Dashboard is an admin-only operational overview. Configuration remains role-aware and routes into Settings; the conversation surface keeps operational detail secondary to starting or resuming a conversation.
- Long prompts and JSON use fixed-height editors so surrounding layout remains stable.

## Access model

The console uses three session-resolved access roles: Admin, User, and Guest. Admin navigation exposes the Settings and configuration group; every role keeps conversations in the left rail, while execution activity stays inside the selected conversation. Sign-in opens in a dismissible modal over that workspace. Every agent carries an access level—Admin only, User, or Guest—so the server can filter agent lists and protect chat, conversations, and activity. The header shows the signed-in account and active role as compact status badges, while the server enforces Admin-only configuration and registry-transfer requests. Demo credentials are environment-backed and establish an HttpOnly session; `OAC_ROLE=guest|user|admin` remains only as a backwards-compatible fallback when no accounts are configured.

## A2A exposure management

A2A exposure management belongs only in the admin Settings surface. It uses the shared browse-first registry pattern: a status list is visible, while create/edit is a closed-by-default dialog with `Field`, `SearchableSelect`, app-owned banners, and icon actions. Draft, published, paused, and unavailable states are paired with text and color. The UI displays the safe Agent Card route, auth mode, credential variable name, and limits; it never displays bearer values, agent instructions, memory, or tools.

## Controls and hierarchy

- The shared action-button family uses compact primary, secondary, quiet, and danger variants with consistent sizing and optional leading icons; cyan primary actions are reserved for commit, create, launch, and save operations.
- Secondary and quiet actions are compact and low-emphasis; visible text remains for decisions where the action meaning should be immediately clear.
- Repeated row actions use one consistent icon-button language (test, edit, open, inspect, duplicate, enable, and delete) with an accessible name and hover/focus tooltip; conversation rows keep opening as the primary target and reveal delete on hover/focus; primary decisions retain text when context matters.
- Destructive actions use the danger treatment and require an app-owned confirmation.
- Status text accompanies color so enabled, failed, disabled, and loading states remain understandable without color perception.
- Registry rows show the record name, important state, and the next available action without hiding controls in an overflow menu.

## Interaction states

- Initial data load uses a compact loading state.
- API failures appear in an app-owned alert banner with a recoverable action when possible.
- Successful mutations appear in an app-owned status banner.
- Delete uses dialog semantics, Escape/Cancel support, and an explicit consequence.
- Empty states explain what the operator can do next.
- Effective prompts are read-only previews with clear labeling.
- Chat owns the full application workspace so message flow, agent identity, cancellation, usage, and recovery stay visually primary; the left rail remains persistent for navigation and conversation history.
- Chat messages use asymmetric role-coded bubbles: the operator message is right-aligned and cyan, while the agent response is left-aligned and surface-toned with a restrained accent marker. The workspace is borderless and content-first; the composer uses a soft input affordance, compact attachment and voice controls, and makes Enter/Shift+Enter behavior explicit.
- Attachments are bounded at the API boundary and remain visibly attached to the user message after send and session reopen. Text-like files contribute bounded extracted text to the current and subsequent model turns; other accepted files remain visible as named attachment context. Voice input uses browser speech recognition when available and is hidden when the browser does not support it.
- Streaming, cancellation, usage, and failed executions remain visible in the selected conversation's Activity disclosure.

## Accessibility and localization

- Every control has a visible label or explicit accessible name.
- Icon-only controls keep a minimum 34px target and expose the same action through `aria-label`, `title`, and the app-owned tooltip.
- Focus-visible outlines use the primary signal color.
- Status and error banners use live-region semantics.
- The delete confirmation uses dialog semantics; browser confirm/alert/prompt are not used.
- Keyboard operation is required for navigation, ordered mappings, forms, and chat.
- Reduced-motion and forced-colors fallbacks are part of the baseline.
- Copy is concise English-first; dates follow the browser locale; IDs and JSON remain exact.

## Implementation source

This document describes the intent. The implementation source of truth is:

- tokens and responsive behavior: src/web/styles.css;
- component structure and interaction: src/web/App.tsx;
- conversation thread and composer behavior: @assistant-ui/react through the app-owned external-store adapter in src/web/App.tsx;
- user-visible rules: UX-CONTRACT.md;
- runtime and persistence behavior: ARCHITECTURE.md; and
- accepted payloads and limits: src/server/domain/schemas.ts.
