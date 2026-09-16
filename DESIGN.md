---
name: Open Agent Console
version: 0.4.0
purpose: Local control panel for configuring and running bounded AI agents
---

# Open Agent Console — design context

## North star

Open Agent Console is an avionics-style flight deck for assembling small agent crews. The interface should feel calm, instrumented and local: a clear operating surface for configuration, prompt composition, bounded actions and execution history.

## Canonical visual language

- Canvas: near-black blue-green `#071014`; surfaces: `#0e1b20` and `#13252b`.
- Primary signal: cyan `#49d3d0`; secondary attention: amber `#f6b95b`.
- Success: `#6ed9a7`; danger: `#f2839b`; body text: `#e8eef3`; muted text: `#8ea4a8`.
- Borders are quiet blue-green rules, not white cards. Elevated surfaces use a restrained shadow and a subtle diagonal gradient.
- Typography uses the system sans stack for the operational UI and a monospace stack for IDs, JSON, prompts and correlation values.
- Buttons are compact instrument controls. The cyan primary action is reserved for commit/launch actions; secondary controls are outlined; destructive actions use the danger treatment.

## Layout and behavior

- The fixed desktop rail becomes a horizontal scrollable navigation strip below 720px.
- The main surface uses a 12-column mental grid: registry list and editor split on desktop, stacked on narrow screens.
- Dashboard is the flight deck: inventory counts, enabled agents, recent failures and direct routes to the registries.
- Registry screens keep the list visible beside the editor so a user can compare current state before committing a change.
- Agent mappings use checkboxes plus explicit up/down controls. Ordering is visible and keyboard-operable; drag-and-drop is not required.
- Long prompts and JSON are presented in fixed-height, non-resizing editors so the surrounding layout stays stable.

## Interaction states

- Initial registry load shows a compact loading state; failures appear in an app-owned alert banner.
- Mutations report success in an app-owned status banner. Destructive actions use an app-owned modal with Escape and Cancel support; browser confirm/alert/prompt are not used.
- Empty states explain what the user can do next. Disabled registry records remain visible with an explicit status.
- Effective prompts are read-only previews and are labeled as such.
- Chat remains a focused drawer so the user can keep registry context while running an agent. Streaming, cancellation and usage are visible.

## Accessibility and localization

- Every form control has an explicit label or accessible name; focus-visible outlines use the cyan signal color.
- Status and error banners use live regions. The delete modal uses dialog semantics and a visible Cancel action.
- Color is paired with text labels such as `enabled`, `failed` and `disabled`.
- Copy is English-first and concise. Dates use the browser locale; persisted IDs and JSON remain exact.
- Reduced-motion and forced-colors fallbacks are part of the baseline.

## Source of truth

This file mirrors the implemented tokens in `src/web/styles.css`. Product behavior is defined in `UX-CONTRACT.md`; persistence and runtime behavior are defined in `ARCHITECTURE.md` and `src/server/domain/schemas.ts`.
