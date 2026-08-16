import { createServer } from './server.js';

export * from './config/index.js';
export * from './domain/models/types.js';
export * from './domain/models/step.js';
export * from './domain/models/artifact.js';
export * from './domain/models/project.js';
export * from './domain/models/build-job.js';
export * from './domain/models/template.js';
export * from './domain/errors/domain-error.js';
export * from './domain/errors/not-found.error.js';
export * from './domain/events/build-events.js';
export * from './domain/ports/inbound/project-use-cases.js';
export * from './domain/ports/inbound/build-use-cases.js';
export * from './domain/ports/inbound/template-use-cases.js';
export * from './domain/ports/outbound/project-repository.port.js';
export * from './domain/ports/outbound/build-repository.port.js';
export * from './domain/ports/outbound/artifact-storage.port.js';
export * from './domain/ports/outbound/execution-engine.port.js';
export * from './domain/ports/outbound/event-publisher.port.js';
export * from './application/index.js';
export * from './infrastructure/persistence/memory-project.repository.js';
export * from './infrastructure/persistence/file-project.repository.js';
export * from './infrastructure/persistence/memory-build.repository.js';
export * from './infrastructure/storage/local-artifact-storage.adapter.js';
export * from './infrastructure/execution/local-process-execution.adapter.js';
export * from './infrastructure/events/event-emitter-publisher.adapter.js';
export * from './infrastructure/templates/default-templates.js';
export * from './api/index.js';
export * from './server.js';

async function bootstrap() {
  const { app, container } = await createServer();
  const config = container.config;

  try {
    const address = await app.listen({
      port: config.values.PORT,
      host: config.values.HOST,
    });
    console.log(`[Agent Nexus Builder] Hexagonal Build Service running at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, closing Agent Nexus Builder...`);
    try {
      await app.close();
      console.log('Builder service closed successfully.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  bootstrap();
}
