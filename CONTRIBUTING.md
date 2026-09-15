# Contributing

## Local development

1. Use Node.js 24 or newer.
2. Copy `.env.example` to `.env` and configure only the credentials you need.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:5173` during development.

Before submitting changes run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Keep the architecture deliberately small. New distributed infrastructure, workflow engines, arbitrary code execution, or agent-per-container behavior require an explicit architectural decision before implementation.
