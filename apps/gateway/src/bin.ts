#!/usr/bin/env node
import { GatewayRuntime } from './runtime.js';

async function main(): Promise<void> {
  const configPath = process.env['ANX_CONFIG'] ?? undefined;
  const runtime = await GatewayRuntime.create(configPath);

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`received ${signal}, shutting down...`);
    try {
      await runtime.stop();
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('shutdown error', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await runtime.start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal', err);
  process.exit(1);
});
