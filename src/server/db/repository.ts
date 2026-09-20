import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./index.js";
import {
  agents,
  agentSkills,
  agentTools,
  a2aAuditEvents,
  a2aExposures,
  a2aTasks,
  mcpServers,
  memories,
  memoryConnectors,
  messages,
  models,
  runs,
  sessions,
  skills,
  toolCalls,
  tools,
} from "./schema.js";

type MessageAttachmentSummary = {
  name: string;
  mimeType: string;
  size: number;
};

function messageAttachmentSummaries(value: string | null | undefined): MessageAttachmentSummary[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.name !== "string" ||
        typeof row.mimeType !== "string" ||
        typeof row.size !== "number" ||
        !Number.isInteger(row.size) ||
        row.size < 0
      ) return [];
      return [{ name: row.name, mimeType: row.mimeType, size: row.size }];
    });
  } catch {
    return [];
  }
}

export type Database = typeof db;

export class RegistryRepository {
  constructor(public readonly database: Database = db) {}

  listModels() {
    return this.database.select().from(models).orderBy(desc(models.createdAt));
  }
  getModel(id: string) {
    return this.database
      .select()
      .from(models)
      .where(eq(models.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertModel(row: typeof models.$inferInsert) {
    return this.database.insert(models).values(row);
  }
  updateModel(id: string, patch: Partial<typeof models.$inferInsert>) {
    return this.database.update(models).set(patch).where(eq(models.id, id));
  }
  deleteModel(id: string) {
    return this.database.delete(models).where(eq(models.id, id));
  }

  listAgents() {
    return this.database.select().from(agents).orderBy(desc(agents.createdAt));
  }
  getAgent(id: string) {
    return this.database
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertAgent(row: typeof agents.$inferInsert) {
    return this.database.insert(agents).values(row);
  }
  updateAgent(id: string, patch: Partial<typeof agents.$inferInsert>) {
    return this.database.update(agents).set(patch).where(eq(agents.id, id));
  }
  deleteAgent(id: string) {
    return this.database.delete(agents).where(eq(agents.id, id));
  }

  listA2aExposures() {
    return this.database.select().from(a2aExposures).orderBy(asc(a2aExposures.slug));
  }
  getA2aExposure(id: string) {
    return this.database
      .select()
      .from(a2aExposures)
      .where(eq(a2aExposures.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  getA2aExposureByAgentId(agentId: string) {
    return this.database
      .select()
      .from(a2aExposures)
      .where(eq(a2aExposures.agentId, agentId))
      .limit(1)
      .then((rows) => rows[0]);
  }
  getA2aExposureBySlug(slug: string) {
    return this.database
      .select()
      .from(a2aExposures)
      .where(eq(a2aExposures.slug, slug))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertA2aExposure(row: typeof a2aExposures.$inferInsert) {
    return this.database.insert(a2aExposures).values(row);
  }
  updateA2aExposure(id: string, patch: Partial<typeof a2aExposures.$inferInsert>) {
    return this.database.update(a2aExposures).set(patch).where(eq(a2aExposures.id, id));
  }
  deleteA2aExposure(id: string) {
    return this.database.delete(a2aExposures).where(eq(a2aExposures.id, id));
  }
  listA2aTasks(exposureId: string, options: { contextId?: string; limit?: number; offset?: number } = {}) {
    return this.database
      .select()
      .from(a2aTasks)
      .where(and(
        eq(a2aTasks.exposureId, exposureId),
        options.contextId ? eq(a2aTasks.contextId, options.contextId) : undefined,
      ))
      .orderBy(desc(a2aTasks.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);
  }
  getA2aTask(id: string) {
    return this.database
      .select()
      .from(a2aTasks)
      .where(eq(a2aTasks.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  getA2aTaskByMessageId(exposureId: string, messageId: string) {
    return this.database
      .select()
      .from(a2aTasks)
      .where(and(eq(a2aTasks.exposureId, exposureId), eq(a2aTasks.clientMessageId, messageId)))
      .limit(1)
      .then((rows) => rows[0]);
  }
  countA2aTasks(exposureId: string, states = ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"]) {
    return this.database
      .select({ total: count() })
      .from(a2aTasks)
      .where(and(eq(a2aTasks.exposureId, exposureId), inArray(a2aTasks.state, states)))
      .then((rows) => Number(rows[0]?.total ?? 0));
  }
  insertA2aTask(row: typeof a2aTasks.$inferInsert) {
    return this.database.insert(a2aTasks).values(row);
  }
  updateA2aTask(id: string, patch: Partial<typeof a2aTasks.$inferInsert>) {
    return this.database.update(a2aTasks).set(patch).where(eq(a2aTasks.id, id));
  }
  insertA2aAuditEvent(row: typeof a2aAuditEvents.$inferInsert) {
    return this.database.insert(a2aAuditEvents).values(row);
  }
  listA2aAuditEvents(exposureId: string, limit = 100) {
    return this.database
      .select()
      .from(a2aAuditEvents)
      .where(eq(a2aAuditEvents.exposureId, exposureId))
      .orderBy(desc(a2aAuditEvents.createdAt))
      .limit(limit);
  }

  listSkills() {
    return this.database.select().from(skills).orderBy(asc(skills.name));
  }
  getSkill(id: string) {
    return this.database
      .select()
      .from(skills)
      .where(eq(skills.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertSkill(row: typeof skills.$inferInsert) {
    return this.database.insert(skills).values(row);
  }
  updateSkill(id: string, patch: Partial<typeof skills.$inferInsert>) {
    return this.database.update(skills).set(patch).where(eq(skills.id, id));
  }
  deleteSkill(id: string) {
    return this.database.delete(skills).where(eq(skills.id, id));
  }
  async listAgentSkills(agentId: string) {
    return this.database
      .select({ skill: skills, position: agentSkills.position })
      .from(agentSkills)
      .innerJoin(skills, eq(agentSkills.skillId, skills.id))
      .where(eq(agentSkills.agentId, agentId))
      .orderBy(asc(agentSkills.position));
  }
  listAllAgentSkills() {
    return this.database
      .select()
      .from(agentSkills)
      .orderBy(asc(agentSkills.agentId), asc(agentSkills.position));
  }
  async replaceAgentSkills(agentId: string, skillIds: string[]) {
    await this.database
      .delete(agentSkills)
      .where(eq(agentSkills.agentId, agentId));
    if (skillIds.length)
      await this.database
        .insert(agentSkills)
        .values(
          skillIds.map((skillId, position) => ({
            id: randomUUID(),
            agentId,
            skillId,
            position,
          })),
        );
  }

  listTools() {
    return this.database.select().from(tools).orderBy(asc(tools.name));
  }
  getTool(id: string) {
    return this.database
      .select()
      .from(tools)
      .where(eq(tools.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertTool(row: typeof tools.$inferInsert) {
    return this.database.insert(tools).values(row);
  }
  updateTool(id: string, patch: Partial<typeof tools.$inferInsert>) {
    return this.database.update(tools).set(patch).where(eq(tools.id, id));
  }
  deleteTool(id: string) {
    return this.database.delete(tools).where(eq(tools.id, id));
  }
  async listAgentTools(agentId: string) {
    return this.database
      .select({ tool: tools, position: agentTools.position })
      .from(agentTools)
      .innerJoin(tools, eq(agentTools.toolId, tools.id))
      .where(eq(agentTools.agentId, agentId))
      .orderBy(asc(agentTools.position));
  }
  listAllAgentTools() {
    return this.database
      .select()
      .from(agentTools)
      .orderBy(asc(agentTools.agentId), asc(agentTools.position));
  }
  async replaceAgentTools(agentId: string, toolIds: string[]) {
    await this.database
      .delete(agentTools)
      .where(eq(agentTools.agentId, agentId));
    if (toolIds.length)
      await this.database
        .insert(agentTools)
        .values(
          toolIds.map((toolId, position) => ({
            id: randomUUID(),
            agentId,
            toolId,
            position,
          })),
        );
  }

  listMcpServers() {
    return this.database
      .select()
      .from(mcpServers)
      .orderBy(asc(mcpServers.name));
  }
  getMcpServer(id: string) {
    return this.database
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertMcpServer(row: typeof mcpServers.$inferInsert) {
    return this.database.insert(mcpServers).values(row);
  }
  updateMcpServer(id: string, patch: Partial<typeof mcpServers.$inferInsert>) {
    return this.database
      .update(mcpServers)
      .set(patch)
      .where(eq(mcpServers.id, id));
  }
  deleteMcpServer(id: string) {
    return this.database.delete(mcpServers).where(eq(mcpServers.id, id));
  }

  listMemoryConnectors() {
    return this.database
      .select()
      .from(memoryConnectors)
      .orderBy(asc(memoryConnectors.name));
  }
  getMemoryConnector(id: string) {
    return this.database
      .select()
      .from(memoryConnectors)
      .where(eq(memoryConnectors.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  insertMemoryConnector(row: typeof memoryConnectors.$inferInsert) {
    return this.database.insert(memoryConnectors).values(row);
  }
  updateMemoryConnector(
    id: string,
    patch: Partial<typeof memoryConnectors.$inferInsert>,
  ) {
    return this.database
      .update(memoryConnectors)
      .set(patch)
      .where(eq(memoryConnectors.id, id));
  }
  deleteMemoryConnector(id: string) {
    return this.database
      .delete(memoryConnectors)
      .where(eq(memoryConnectors.id, id));
  }
  listMemories(agentId: string, connectorId: string, limit = 100) {
    return this.database
      .select()
      .from(memories)
      .where(eq(memories.agentId, agentId))
      .orderBy(desc(memories.updatedAt))
      .limit(limit)
      .then((rows) => rows.filter((row) => row.connectorId === connectorId));
  }
  getMemory(id: string) {
    return this.database
      .select()
      .from(memories)
      .where(eq(memories.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  updateMemory(id: string, patch: Partial<typeof memories.$inferInsert>) {
    return this.database.update(memories).set(patch).where(eq(memories.id, id));
  }
  listAllMemories() {
    return this.database
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt));
  }
  insertMemory(row: typeof memories.$inferInsert) {
    return this.database.insert(memories).values(row);
  }
  deleteMemory(id: string) {
    return this.database.delete(memories).where(eq(memories.id, id));
  }

  listSessions(offset: number, limit: number, agentId?: string) {
    return this.database
      .select()
      .from(sessions)
      .where(agentId ? eq(sessions.agentId, agentId) : undefined)
      .orderBy(desc(sessions.updatedAt))
      .limit(limit)
      .offset(offset);
  }
  countSessions(agentId?: string) {
    return this.database
      .select({ total: count() })
      .from(sessions)
      .where(agentId ? eq(sessions.agentId, agentId) : undefined)
      .then((rows) => Number(rows[0]?.total ?? 0));
  }
  getSession(id: string) {
    return this.database
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }
  listMessages(sessionId: string) {
    return this.database
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.createdAt))
      .then((rows) => rows.map(({ attachmentsJson, ...message }) => ({
        ...message,
        attachments: messageAttachmentSummaries(attachmentsJson),
      })));
  }
  insertSession(row: typeof sessions.$inferInsert) {
    return this.database.insert(sessions).values(row);
  }
  updateSession(id: string, patch: Partial<typeof sessions.$inferInsert>) {
    return this.database.update(sessions).set(patch).where(eq(sessions.id, id));
  }
  deleteSession(id: string) {
    return this.database.delete(sessions).where(eq(sessions.id, id));
  }
  insertMessage(row: typeof messages.$inferInsert) {
    return this.database.insert(messages).values(row);
  }

  listRuns(
    offset: number,
    limit: number,
    filters: { agentId?: string; sessionId?: string; status?: string } = {},
  ) {
    const conditions = [
      filters.agentId ? eq(runs.agentId, filters.agentId) : undefined,
      filters.sessionId ? eq(runs.sessionId, filters.sessionId) : undefined,
      filters.status ? eq(runs.status, filters.status) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const condition = conditions.length > 0 ? and(...conditions) : undefined;
    return this.database
      .select()
      .from(runs)
      .where(condition)
      .orderBy(desc(runs.startedAt))
      .limit(limit)
      .offset(offset);
  }
  countRuns(filters: { agentId?: string; sessionId?: string; status?: string } = {}) {
    const conditions = [
      filters.agentId ? eq(runs.agentId, filters.agentId) : undefined,
      filters.sessionId ? eq(runs.sessionId, filters.sessionId) : undefined,
      filters.status ? eq(runs.status, filters.status) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
    const condition = conditions.length > 0 ? and(...conditions) : undefined;
    return this.database
      .select({ total: count() })
      .from(runs)
      .where(condition)
      .then((rows) => Number(rows[0]?.total ?? 0));
  }
  insertRun(row: typeof runs.$inferInsert) {
    return this.database.insert(runs).values(row);
  }
  getRun(id: string) {
    return this.database
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1)
      .then((rows) => rows[0]);
  }

  insertToolCall(row: typeof toolCalls.$inferInsert) {
    return this.database.insert(toolCalls).values(row);
  }
  updateToolCall(id: string, patch: Partial<typeof toolCalls.$inferInsert>) {
    return this.database
      .update(toolCalls)
      .set(patch)
      .where(eq(toolCalls.id, id));
  }
  listToolCalls(runId: string) {
    return this.database
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .orderBy(asc(toolCalls.startedAt));
  }
}
