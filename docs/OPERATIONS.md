# Operations guide

This application is designed for a local or tightly controlled deployment. It includes environment-backed demo authentication, HttpOnly session cookies, and API-enforced Admin/User/Guest authorization.

## Deployment checklist

Before starting a deployment:

1. Use Node.js 24+ for local execution or the published Node 24 image.
2. Set the Admin and User credential variables; replace the demo values before exposure.
3. Keep the control panel bound to localhost unless an authenticated TLS reverse proxy is in front of it.
4. Provide only the provider environment variables required by the configured model records.
5. Mount persistent storage at /data.
6. If publishing A2A exposures, set `OAC_A2A_PUBLIC_BASE_URL` to the trusted external HTTPS origin.
7. Confirm that /api/health and /api/ready respond successfully.
8. Keep the previous image digest and a recent SQLite backup available before an upgrade.

Docker Compose supplies the recommended local deployment. It sets the container user, volume, healthcheck, restart policy, localhost binding, and migration directory.

## Environment and secrets

Model records store environment-variable names, not credentials. MCP header configuration should use an object such as:

    { "Authorization": { "env": "MCP_AUTH_TOKEN" } }

Do not place API keys, bearer tokens, passwords, or raw secret-like values in registry export files, tool configuration, Compose files committed to Git, or issue comments.

Admin-managed A2A exposures store an environment-variable name such as `A2A_API_TOKEN`, never the token itself. The transport is available only when an administrator explicitly enables and publishes an exposure. Bearer tokens are compared in constant time, represented in audit records only by a one-way caller fingerprint, and are never logged or returned. Rotate a credential by changing the environment value and restarting the process; disable the exposure immediately if rotation is urgent.

The A2A gateway is intentionally in-process. Rate limiting is process-local, task state is durable in SQLite, and active tasks are marked failed with `SERVICE_RESTARTED` during a restart instead of being resumed without a lease. Use a trusted TLS reverse proxy with a stable `OAC_A2A_PUBLIC_BASE_URL` before external publication; do not rely on a client-supplied Host header for advertised URLs in production.

A published exposure can be rolled back without a migration by setting `enabled: false` or `published: false` in the admin Settings dialog. The Agent Card then becomes unavailable and new tasks are rejected; existing completed task records remain subject to the normal database retention policy.

Provider credentials are read by the server process. Changing a credential requires restarting the process or container if the provider client was already constructed.

On startup, configured OpenAI, OpenRouter, Anthropic, and Google credentials are used to discover available models and register missing model records. Discovery is idempotent and preserves existing model records. If one provider is unavailable or rejects its credential, the server logs the provider failure and continues without registering that provider's models. Discovery is bounded by `OAC_PROVIDER_DISCOVERY_TIMEOUT_MS` and `OAC_PROVIDER_DISCOVERY_MAX_MODELS`.

## Health checks

Use the liveness endpoint to confirm that the process is responding:

    curl --fail http://127.0.0.1:3000/api/health

Use readiness to confirm that SQLite is open and queryable:

    curl --fail http://127.0.0.1:3000/api/ready

The image healthcheck uses liveness. Deployment automation should use readiness before sending traffic or running smoke requests.

For a failure, inspect:

    docker compose ps
    docker compose logs --tail=200 open-agent-console

A readiness failure usually means an unavailable or unwritable database path, a failed migration, or a process startup error.

## Backups

Stop the application before taking a file-level SQLite backup:

    docker compose stop
    docker run --rm \
      -v open-agent-console-data:/data:ro \
      -v "$PWD/backups:/backup" \
      alpine:3.20 \
      sh -c 'tar czf /backup/open-agent-console-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /data .'
    docker compose start

The archive must include the database file and its -wal and -shm companions when present. Keep backups outside the Docker volume and protect them as sensitive operational data.

A registry export is useful for moving configuration between installations, but it is not a database backup. It excludes sessions, runs, messages, tool-call history, and long-term memories.

## Upgrade procedure

1. Back up the database as described above.
2. Record the current image digest and application version.
3. Pull/build the new image.
4. Start the new image with the same /data volume.
5. Wait for /api/ready.
6. Review migration and application logs.
7. Run a fake-model smoke chat and inspect the resulting run.
8. Keep the previous image digest until the new deployment is accepted.

Migrations run automatically during startup. Never delete /data as part of an upgrade.

## Rollback procedure

1. Stop the current container.
2. Restore the database backup if the migration or application changed the stored data incompatibly.
3. Redeploy the previous immutable image digest, not a mutable latest tag.
4. Wait for /api/ready and run a smoke chat.
5. Inspect logs and confirm the expected registry/session state.

A rollback is safe only when the previous image can read the restored database schema. See docs/MIGRATIONS.md for compatibility guidance.

## Release procedure

The main branch workflow runs all verification gates before image publication. A version tag must match the package version, for example package version 0.4.0 requires tag v0.4.0.

The release workflow:

1. builds and tests the application;
2. builds the production container and runs container/Compose acceptance;
3. publishes multi-architecture latest and immutable SHA tags to Docker Hub;
4. records the resulting image digest; and
5. creates the GitHub release only after image publication succeeds.

Use immutable SHA or digest references in deployment manifests and keep the digest in the release record.

## Data retention and cleanup

Session, run, message, tool-call, and memory records are persistent until explicitly removed through the control panel/API or the database is restored from an older backup. Registry import does not delete records that are absent from the import; review the target registry before transferring configuration.

To start a clean local demo, remove the Compose volume intentionally:

    docker compose down -v
    docker compose up --build -d

Do not use that command in an environment containing production data.

## Security review

Before exposing the application beyond localhost, verify:

- TLS terminates at a trusted reverse proxy;
- authentication and authorization are enforced outside this application;
- the reverse proxy does not expose the SQLite volume or Docker socket;
- provider and MCP credentials are supplied through a secret manager or protected environment;
- outbound HTTP/MCP targets are expected and public; and
- logs and backups do not contain secret values.

The application validates public DNS, pins connections, rejects redirects/origin changes, limits response sizes, and bounds model/tool execution. These controls reduce SSRF and resource-exhaustion risk but do not replace network policy or identity controls.

## A2A operations

Monitor A2A status codes and audit actions for `Unauthenticated`, `RateLimitExceeded`, `TASK_QUOTA_EXCEEDED`, `task.failed`, and `SERVICE_RESTARTED`. Do not record request bodies or bearer headers in reverse-proxy access logs. The current Agent Card declares streaming support per exposure and explicitly declares push notifications and extended cards unsupported.
