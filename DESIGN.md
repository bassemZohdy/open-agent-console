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
| Primary signal | #49d3d0 |
| Attention | #f6b95b |
| Success | #6ed9a7 |
| Danger | #f2839b |
| Body text | #e8eef3 |
| Muted text | #8ea4a8 |

Use quiet blue-green borders instead of white cards. Use restrained shadows and subtle gradients for elevation. The operational UI uses a system sans stack; IDs, JSON, prompts, and correlation IDs use a monospace stack.

## Layout

- The desktop shell uses a fixed navigation rail and a 12-column mental grid.
- Registry pages keep the list and editor visible together on wide screens.
- The list/editor split stacks on narrow screens.
- Below 720px, navigation becomes a horizontally scrollable strip.
- Dashboard is the flight deck: inventory counts, enabled agents, recent failures, and direct routes to registries.
- Long prompts and JSON use fixed-height editors so surrounding layout remains stable.

## Controls and hierarchy

- Cyan primary actions are reserved for commit, create, launch, and save operations.
- Secondary actions are outlined and compact.
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
- Chat is a focused drawer so registry context remains visible while an agent runs.
- Streaming, cancellation, usage, and failed runs remain visible in the drawer or run history.

## Accessibility and localization

- Every control has a visible label or explicit accessible name.
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
- user-visible rules: UX-CONTRACT.md;
- runtime and persistence behavior: ARCHITECTURE.md; and
- accepted payloads and limits: src/server/domain/schemas.ts.
