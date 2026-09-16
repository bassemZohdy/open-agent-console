import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

export function createDatabase(dbFile = process.env.DB_FILE_NAME ?? './data/open-agent-console.db') {
  if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true });

  const sqlite = new DatabaseSync(dbFile, { timeout: 5_000 });
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');

  const database = drizzle({ client: sqlite });
  const migrationsFolder = process.env.DB_MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle');
  migrate(database, { migrationsFolder });

  return { db: database, sqlite };
}

const connection = createDatabase();
export const db = connection.db;
export const sqlite = connection.sqlite;

export function closeDatabase(): void {
  sqlite.close();
}
