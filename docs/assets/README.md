# Demo media

These assets are real browser captures of the current control panel:

- dashboard.png — dashboard inventory and runtime readiness;
- agent-chat.png — an agent registry with a persisted chat drawer and deterministic response;
- run-detail.png — the completed run list and run-detail panel; and
- open-agent-console-demo.webm — a short browser walkthrough of the same flow.

## Capture metadata

| Field | Value |
| --- | --- |
| Provider | fake |
| Model ID | deterministic |
| Credentials | none |
| Viewport | 1440 × 900 CSS pixels |
| Browser | Playwright Chromium |
| UI base URL | http://127.0.0.1:5173 |
| API base URL | http://127.0.0.1:3000 |
| Database | isolated SQLite file supplied through DB_FILE_NAME |
| Capture command | npm run capture:demo |

The generated names include a timestamp suffix so repeated captures do not conflict with existing local data. The screenshots and video are documentation artifacts, not test fixtures. Regenerate them after major UI changes and review the visual output before committing.

