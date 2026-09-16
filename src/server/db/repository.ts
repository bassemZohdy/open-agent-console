import { asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import {
  agents, agentSkills, agentTools, mcpServers, memories, memoryConnectors, messages, models, runs, sessions, skills, toolCalls, tools,
} from './schema.js';

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

  listSkills() { return this.database.select().from(skills).orderBy(asc(skills.name)); }
  getSkill(id: string) { return this.database.select().from(skills).where(eq(skills.id, id)).limit(1).then((rows) => rows[0]); }
  insertSkill(row: typeof skills.$inferInsert) { return this.database.insert(skills).values(row); }
  updateSkill(id: string, patch: Partial<typeof skills.$inferInsert>) { return this.database.update(skills).set(patch).where(eq(skills.id, id)); }
  deleteSkill(id: string) { return this.database.delete(skills).where(eq(skills.id, id)); }
  async listAgentSkills(agentId: string) {
    return this.database.select({ skill: skills, position: agentSkills.position }).from(agentSkills)
      .innerJoin(skills, eq(agentSkills.skillId, skills.id)).where(eq(agentSkills.agentId, agentId)).orderBy(asc(agentSkills.position));
  }
  async replaceAgentSkills(agentId: string, skillIds: string[]) {
    await this.database.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
    if (skillIds.length) await this.database.insert(agentSkills).values(skillIds.map((skillId, position) => ({ id: randomUUID(), agentId, skillId, position })));
  }

  listTools() { return this.database.select().from(tools).orderBy(asc(tools.name)); }
  getTool(id: string) { return this.database.select().from(tools).where(eq(tools.id, id)).limit(1).then((rows) => rows[0]); }
  insertTool(row: typeof tools.$inferInsert) { return this.database.insert(tools).values(row); }
  updateTool(id: string, patch: Partial<typeof tools.$inferInsert>) { return this.database.update(tools).set(patch).where(eq(tools.id, id)); }
  deleteTool(id: string) { return this.database.delete(tools).where(eq(tools.id, id)); }
  async listAgentTools(agentId: string) {
    return this.database.select({ tool: tools, position: agentTools.position }).from(agentTools)
      .innerJoin(tools, eq(agentTools.toolId, tools.id)).where(eq(agentTools.agentId, agentId)).orderBy(asc(agentTools.position));
  }
  async replaceAgentTools(agentId: string, toolIds: string[]) {
    await this.database.delete(agentTools).where(eq(agentTools.agentId, agentId));
    if (toolIds.length) await this.database.insert(agentTools).values(toolIds.map((toolId, position) => ({ id: randomUUID(), agentId, toolId, position })));
  }

  listMcpServers() { return this.database.select().from(mcpServers).orderBy(asc(mcpServers.name)); }
  getMcpServer(id: string) { return this.database.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1).then((rows) => rows[0]); }
  insertMcpServer(row: typeof mcpServers.$inferInsert) { return this.database.insert(mcpServers).values(row); }
  updateMcpServer(id: string, patch: Partial<typeof mcpServers.$inferInsert>) { return this.database.update(mcpServers).set(patch).where(eq(mcpServers.id, id)); }
  deleteMcpServer(id: string) { return this.database.delete(mcpServers).where(eq(mcpServers.id, id)); }

  listMemoryConnectors() { return this.database.select().from(memoryConnectors).orderBy(asc(memoryConnectors.name)); }
  getMemoryConnector(id: string) { return this.database.select().from(memoryConnectors).where(eq(memoryConnectors.id, id)).limit(1).then((rows) => rows[0]); }
  insertMemoryConnector(row: typeof memoryConnectors.$inferInsert) { return this.database.insert(memoryConnectors).values(row); }
  updateMemoryConnector(id: string, patch: Partial<typeof memoryConnectors.$inferInsert>) { return this.database.update(memoryConnectors).set(patch).where(eq(memoryConnectors.id, id)); }
  deleteMemoryConnector(id: string) { return this.database.delete(memoryConnectors).where(eq(memoryConnectors.id, id)); }
  listMemories(agentId: string, connectorId: string) { return this.database.select().from(memories).where(eq(memories.agentId, agentId)).orderBy(desc(memories.updatedAt)).then((rows) => rows.filter((row) => row.connectorId === connectorId)); }
  insertMemory(row: typeof memories.$inferInsert) { return this.database.insert(memories).values(row); }
  deleteMemory(id: string) { return this.database.delete(memories).where(eq(memories.id, id)); }

  listSessions(offset: number, limit: number) { return this.database.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(limit).offset(offset); }
  getSession(id: string) { return this.database.select().from(sessions).where(eq(sessions.id, id)).limit(1).then((rows) => rows[0]); }
  listMessages(sessionId: string) { return this.database.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt)); }
  insertSession(row: typeof sessions.$inferInsert) { return this.database.insert(sessions).values(row); }
  insertMessage(row: typeof messages.$inferInsert) { return this.database.insert(messages).values(row); }

  listRuns(offset: number, limit: number) { return this.database.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit).offset(offset); }
  insertRun(row: typeof runs.$inferInsert) { return this.database.insert(runs).values(row); }
  getRun(id: string) { return this.database.select().from(runs).where(eq(runs.id, id)).limit(1).then((rows) => rows[0]); }

  insertToolCall(row: typeof toolCalls.$inferInsert) { return this.database.insert(toolCalls).values(row); }
  updateToolCall(id: string, patch: Partial<typeof toolCalls.$inferInsert>) { return this.database.update(toolCalls).set(patch).where(eq(toolCalls.id, id)); }
  listToolCalls(runId: string) { return this.database.select().from(toolCalls).where(eq(toolCalls.runId, runId)).orderBy(asc(toolCalls.startedAt)); }
}
