# Open Agent Console

Open Agent Console is a lightweight, self-contained web application for configuring, running, and managing multiple small AI agents from reusable registries.

The project is intentionally scoped to stay simple: one application, one Docker image, one SQLite database, and logically instantiated agents running in the same Node.js process.

## Initial goals

- Model registry
- Agent registry
- Tool registry
- Skill registry
- Memory connector registry
- Agent chat with streaming
- Session and run history
- LangChain JS runtime
- SQLite persistence
- Single Docker image

## Non-goals for v1

- Visual workflow designer
- Distributed agent runtime
- Agent-per-container execution
- Kubernetes operator
- Multi-agent orchestration
- A2A
- Enterprise RBAC/SSO
- Arbitrary JavaScript execution from the UI

The bootstrap implementation will evolve this README as the first working vertical slice lands.
