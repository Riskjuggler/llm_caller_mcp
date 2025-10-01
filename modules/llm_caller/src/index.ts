import { loadConfig } from './loadConfig.js';
import { createServer } from './transport.js';
import { createOrchestrator } from './orchestrator.js';
import { createLogger } from './logger.js';
import { createDefaultAdapterDependencies, createProviderAdapters } from './adapters/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  const adapterDeps = createDefaultAdapterDependencies();
  const adapters = createProviderAdapters(config, adapterDeps);
  const orchestrator = createOrchestrator(config, adapters);
  const server = createServer(config, orchestrator, logger);

  await server.start();
  logger.info({ level: 'info', message: 'LLM Caller server started', metadata: { host: config.host, port: config.port } });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Failed to start LLM Caller server', error);
    process.exit(1);
  });
}
