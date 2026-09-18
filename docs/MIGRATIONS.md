# Migration and rollback notes

Open Agent Console runs Drizzle migrations automatically during startup. The migration directory is included in the production image at /app/drizzle, and the default local directory is ./drizzle.

## Migration rules

- Migration files are append-only once merged.
- Use a new timestamped directory for every schema change.
- Test both a fresh database and an existing database with representative registry, session, run, memory, and tool-call data.
- Keep changes backward-compatible with the previous image whenever possible.
- Do not delete the /data volume to make a migration pass.
- Update ARCHITECTURE.md, docs/OPERATIONS.md, docs/API.md, and README.md when schema or behavior changes.

## Current migration sequence

| Migration | Responsibility |
| --- | --- |
| 20260916010000_bootstrap_baseline | Idempotent baseline for the initial application schema |
| 20260916010001_registry_runtime_hardening | Registry/runtime hardening and supporting constraints |
| 20260916030000_skills_tools_memory | Skills, tools, MCP servers, memory connectors, mappings, tool calls, and memories |
| 20260917010000_context_bounds | Context truncation metadata and bounded runtime context support |

The exact SQL is versioned in the drizzle directory and is the source of truth.

## Upgrade procedure

1. Stop or quiesce the current application.
2. Back up the SQLite database together with -wal and -shm files.
3. Record the current image digest and migration version.
4. Start the new image with the same /data volume.
5. Wait for /api/ready.
6. Inspect startup logs for migration errors.
7. Run a fake-provider smoke chat and inspect its run/session result.
8. Keep the previous image and backup until acceptance is complete.

## Compatibility considerations

SQLite foreign keys protect references between registries and history. A model cannot be deleted while an agent references it. Registry imports preserve configuration IDs where possible but do not replace or delete records that are absent from the import.

Adding nullable columns, indexes, tables, or compatible defaults is normally safe. Renaming/removing columns, changing stored meaning, or tightening constraints requires an explicit compatibility and rollback plan.

## Rollback

If the new image fails after migration:

1. stop the new application;
2. restore the pre-upgrade database backup when the schema is not readable by the previous image;
3. redeploy the previous immutable image digest;
4. wait for /api/ready; and
5. run a smoke chat and inspect logs.

Do not roll back only the image when the database has been changed incompatibly. Do not use the mutable latest tag for rollback.

## Verification commands

For a local migration check, point the process at an isolated database:

    DB_FILE_NAME=./data/migration-check.db npm run dev

For container verification:

    docker compose up --build -d
    curl --fail http://127.0.0.1:3000/api/ready
    npm run smoke:compose

The CI Docker and Compose acceptance gates are part of the migration release evidence.
