#!/usr/bin/env node
import { GatewayRuntime } from './runtime.js';

async function handleCliCommand(cmd: string): Promise<boolean> {
  const baseUrl = process.env['NEXUS_GATEWAY_URL'] ?? 'http://127.0.0.1:8787';

  switch (cmd) {
    case 'status': {
      try {
        const res = await fetch(`${baseUrl}/health`);
        const json = await res.json() as { status: string; version: string; endpoints: { healthy: number; total: number }; uptime: number };
        // eslint-disable-next-line no-console
        console.log(`\n🌌 Agent Nexus Gateway (${json.version})`);
        // eslint-disable-next-line no-console
        console.log(`Status: ${json.status === 'ok' ? '✅ HEALTHY' : '⚠️ ' + json.status}`);
        // eslint-disable-next-line no-console
        console.log(`Active Endpoints: ${json.endpoints.healthy} / ${json.endpoints.total}`);
        // eslint-disable-next-line no-console
        console.log(`Uptime: ${Math.round(json.uptime)}s\n`);
      } catch {
        // eslint-disable-next-line no-console
        console.log(`❌ Gateway offline or unreachable at ${baseUrl}`);
      }
      return true;
    }
    case 'doctor': {
      try {
        const res = await fetch(`${baseUrl}/v1/doctor`);
        const json = await res.json() as { checks: { totalModels: number; freeModelsCount: number; activeProviders: number; detectedAgentsCount: number } };
        // eslint-disable-next-line no-console
        console.log(`\n🩺 Nexus Doctor Diagnostic:`);
        // eslint-disable-next-line no-console
        console.log(`✅ Model Registry: ${json.checks.totalModels} models (${json.checks.freeModelsCount} free)`);
        // eslint-disable-next-line no-console
        console.log(`✅ Active Providers: ${json.checks.activeProviders}`);
        // eslint-disable-next-line no-console
        console.log(`✅ Detected Coding Agents: ${json.checks.detectedAgentsCount}\n`);
      } catch {
        // eslint-disable-next-line no-console
        console.log(`❌ Doctor check failed: Gateway unreachable at ${baseUrl}`);
      }
      return true;
    }
    case 'providers': {
      try {
        const res = await fetch(`${baseUrl}/v1/providers`);
        const json = await res.json() as { providers: { id: string; name: string; health: string; activeModelsCount: number }[] };
        // eslint-disable-next-line no-console
        console.log(`\n🔌 Connected Model Providers:`);
        for (const p of json.providers ?? []) {
          // eslint-disable-next-line no-console
          console.log(` - ${p.id.padEnd(16)} [${p.health}] ${p.activeModelsCount ?? 0} active models`);
        }
        // eslint-disable-next-line no-console
        console.log('');
      } catch {
        // eslint-disable-next-line no-console
        console.log(`❌ Failed to list providers at ${baseUrl}`);
      }
      return true;
    }
    case 'agents': {
      try {
        const res = await fetch(`${baseUrl}/v1/runtime-agents`);
        const json = await res.json() as { agents: { id: string; name: string; runnable: boolean; liveVerified: boolean }[] };
        // eslint-disable-next-line no-console
        console.log(`\n🤖 Supported Universal Agents:`);
        for (const a of json.agents ?? []) {
          const status = a.liveVerified ? '✅ VERIFIED' : a.runnable ? '⚡ RUNNABLE' : '❌ NOT FOUND';
          // eslint-disable-next-line no-console
          console.log(` - ${a.name.padEnd(20)} ${status}`);
        }
        // eslint-disable-next-line no-console
        console.log('');
      } catch {
        // eslint-disable-next-line no-console
        console.log(`❌ Failed to query agents from ${baseUrl}`);
      }
      return true;
    }
    case 'models': {
      try {
        const res = await fetch(`${baseUrl}/v1/catalog/status`);
        const json = await res.json() as { catalogVersion: number; models: number; healthyModels: number; freeModels: number; providers: number };
        // eslint-disable-next-line no-console
        console.log(`\n📚 Universal Model Catalog (v${json.catalogVersion}):`);
        // eslint-disable-next-line no-console
        console.log(`Total Models: ${json.models} (${json.freeModels} free, ${json.healthyModels} healthy across ${json.providers} providers)\n`);
      } catch {
        // eslint-disable-next-line no-console
        console.log(`❌ Failed to query catalog from ${baseUrl}`);
      }
      return true;
    }
    default:
      return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0]?.toLowerCase();

  if (subcommand && ['doctor', 'status', 'providers', 'agents', 'models'].includes(subcommand)) {
    const handled = await handleCliCommand(subcommand);
    if (handled) process.exit(0);
  }

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
