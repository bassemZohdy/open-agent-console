# Migration and rollback notes

Each release runs Drizzle migrations when the application starts. Back up the
SQLite database before upgrading, and keep the previous image digest available
for rollback.

To roll back, redeploy the previous immutable image digest and restore the
database backup if the migration is not backward compatible. Verify `/api/ready`
and inspect the application logs before returning traffic.
