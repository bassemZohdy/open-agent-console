import 'dotenv/config';
import { buildApp } from './app.js';
import { RegistryRepository } from './db/repository.js';
import { syncConfiguredProviderModels } from './runtime/provider-model-sync.js';

const repository = new RegistryRepository();
const app = buildApp({ repository });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port, host });
  const sync = await syncConfiguredProviderModels(repository, {
    logger: {
      info: (context, message) => app.log.info(context, message),
      warn: (context, message) => app.log.warn(context, message),
    },
  });
  app.log.info(sync, 'provider model discovery complete');
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
