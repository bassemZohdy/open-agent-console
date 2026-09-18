import { sqlite } from "./db/index.js";
import { RegistryRepository } from "./db/repository.js";
import { AgentRuntimeManager } from "./runtime/agent-runtime-manager.js";

export type AppDependencies = {
  repository?: RegistryRepository;
  runtime?: AgentRuntimeManager;
  sqlite?: typeof sqlite;
};

export function resolveAppDependencies(options: AppDependencies = {}) {
  const repository = options.repository ?? new RegistryRepository();
  return {
    repository,
    runtime: options.runtime ?? new AgentRuntimeManager({ database: repository.database, repository }),
    sqlite: options.sqlite ?? sqlite,
  };
}
