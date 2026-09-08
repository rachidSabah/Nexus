/**
 * Agent Nexus Desktop — Entrypoint
 */

import { DesktopTrayController } from './tray.js';

export async function main(): Promise<void> {
  const controller = new DesktopTrayController({
    onStatusChange: (status, details) => {
      console.log(`[Desktop] Status changed: ${status} (${details.activeModels} models available)`);
    },
    onNotification: (title, message) => {
      console.log(`[Desktop] Notification: ${title} - ${message}`);
    },
  });

  console.log('[Desktop] Agent Nexus Desktop Shell initializing...');
  const initial = await controller.checkGatewayHealth();
  console.log(`[Desktop] Initial gateway state: ${initial.status} at ${initial.gatewayUrl}`);

  controller.startPolling();

  const shutdown = () => {
    console.log('[Desktop] Shutting down desktop shell...');
    controller.stopPolling();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js')) {
  void main();
}
