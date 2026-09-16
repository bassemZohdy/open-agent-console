import { asc, desc, eq } from 'drizzle-orm';
import { db } from './index.js';
import { agents, messages, models, runs, sessions } from './schema.js';

export type Database = typeof db;

export class RegistryRepository {
  constructor(private readonly database: Database = db) {}

  listModels() { return this.database.select().from(models).orderBy(desc(models.createdAt)); }
  getModel(id: string) { return this.database.select().from(models).where(eq(models.id, id)).limit(1).then((rows) => rows[0]); }
  insertModel(row: typeof models.$inferInsert) { return this.database.insert(models).values(row); }
  updateModel(id: string, patch: Partial<typeof models.$inferInsert>) { return this.database.update(models).set(patch).where(eq(models.id, id)); }
  deleteModel(id: string) { return this.database.delete(models).where(eq(models.id, id)); }

  listAgents() { return this.database.select().from(agents).orderBy(desc(agents.createdAt)); }
  getAgent(id: string) { return this.database.select().from(agents).where(eq(agents.id, id)).limit(1).then((rows) => rows[0]); }
  insertAgent(row: typeof agents.$inferInsert) { return this.database.insert(agents).values(row); }
  updateAgent(id: string, patch: Partial<typeof agents.$inferInsert>) { return this.database.update(agents).set(patch).where(eq(agents.id, id)); }
  deleteAgent(id: string) { return this.database.delete(agents).where(eq(agents.id, id)); }

  listSessions(offset: number, limit: number) { return this.database.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(limit).offset(offset); }
  getSession(id: string) { return this.database.select().from(sessions).where(eq(sessions.id, id)).limit(1).then((rows) => rows[0]); }
  listMessages(sessionId: string) { return this.database.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt)); }
  insertSession(row: typeof sessions.$inferInsert) { return this.database.insert(sessions).values(row); }
  insertMessage(row: typeof messages.$inferInsert) { return this.database.insert(messages).values(row); }

  listRuns(offset: number, limit: number) { return this.database.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit).offset(offset); }
  insertRun(row: typeof runs.$inferInsert) { return this.database.insert(runs).values(row); }
  getRun(id: string) { return this.database.select().from(runs).where(eq(runs.id, id)).limit(1).then((rows) => rows[0]); }
}
