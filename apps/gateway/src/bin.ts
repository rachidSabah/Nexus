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

  // Never let a single bad upstream response take down the whole gateway.
  // ERR_STREAM_WRITE_AFTER_END and friends are handled at the route level,
  // but any residual unhandled stream/network error should be logged and
  // tolerated, not crash the process (which kills every in-flight request).
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[uncaughtException] tolerated:', err?.message ?? err);
  });
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[unhandledRejection] tolerated:', (reason as Error)?.message ?? reason);
  });

  await runtime.start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal', err);
  process.exit(1);
});
