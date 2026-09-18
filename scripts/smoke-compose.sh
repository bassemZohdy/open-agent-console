#!/usr/bin/env bash
set -euo pipefail

project="oac-smoke-${RANDOM}-${RANDOM}"
tmp_dir="$(mktemp -d)"
env_file="$tmp_dir/smoke.env"
cleanup() {
  OAC_ENV_FILE="$env_file" docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

cat > "$env_file" <<'EOF'
OPENAI_API_KEY=
OAC_MCP_TIMEOUT_MS=15000
OAC_MAX_MCP_RESPONSE_BYTES=1000000
EOF

OAC_ENV_FILE="$env_file" docker compose -p "$project" up --build -d
for attempt in {1..45}; do
  if curl --fail --silent http://127.0.0.1:3000/api/ready >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3000/api/ready >/dev/null

model_id="$(curl --fail --silent -X POST http://127.0.0.1:3000/api/models \
  -H 'content-type: application/json' \
  -d '{"name":"Compose fake","provider":"fake","modelId":"deterministic","apiKeyEnv":"","capabilities":["streaming"],"timeoutMs":10000,"maxRetries":0}' | jq -r .id)"
agent_id="$(curl --fail --silent -X POST http://127.0.0.1:3000/api/agents \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Compose agent\",\"modelRef\":\"$model_id\",\"instructions\":\"Reply with a deterministic compose response.\"}" | jq -r .id)"
curl --fail --silent -N -X POST "http://127.0.0.1:3000/api/agents/$agent_id/chat" \
  -H 'content-type: application/json' \
  -d '{"message":"compose smoke test"}' | grep -q 'event: done'

echo "Docker Compose smoke test passed."
