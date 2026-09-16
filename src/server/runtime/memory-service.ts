import type { InferSelectModel } from 'drizzle-orm';
import { RegistryRepository } from '../db/repository.js';
import type { agents, memories } from '../db/schema.js';

type AgentRecord = InferSelectModel<typeof agents>;
type MemoryRecord = InferSelectModel<typeof memories>;

export interface MemoryConnectorRuntime {
  readonly type: string;
  load(agent: AgentRecord): Promise<MemoryRecord[]>;
}

class NoneMemoryConnector implements MemoryConnectorRuntime {
  readonly type = 'none';
  async load(): Promise<MemoryRecord[]> { return []; }
}

class SqliteMemoryConnector implements MemoryConnectorRuntime {
  readonly type = 'sqlite';
  constructor(private readonly repository: RegistryRepository, private readonly connectorId: string) {}
  load(agent: AgentRecord): Promise<MemoryRecord[]> {
    return this.repository.listMemories(agent.id, this.connectorId);
  }
}

export async function resolveMemoryConnector(repository: RegistryRepository, agent: AgentRecord): Promise<MemoryConnectorRuntime> {
  if (!agent.memoryConnectorId) return new NoneMemoryConnector();
  const connector = await repository.getMemoryConnector(agent.memoryConnectorId);
  if (!connector || !connector.enabled || connector.type === 'none') return new NoneMemoryConnector();
  if (connector.type === 'sqlite') return new SqliteMemoryConnector(repository, connector.id);
  throw new Error(`Unsupported memory connector type: ${connector.type}`);
}
