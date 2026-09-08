import { describe, it, expect, vi } from 'vitest';
import { DesktopTrayController, type TrayStatus, type TrayStatusDetails } from '../src/tray.js';

describe('DesktopTrayController', () => {
  it('initializes with default config and stopped state', () => {
    const controller = new DesktopTrayController();
    const details = controller.getStatusDetails();
    expect(details.status).toBe('stopped');
    expect(details.activeModels).toBe(0);
    expect(details.gatewayUrl).toBe('http://127.0.0.1:19808');
    expect(details.dashboardUrl).toBe('http://127.0.0.1:3000');
  });

  it('detects gateway unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const controller = new DesktopTrayController({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const details = await controller.checkGatewayHealth();
    expect(details.status).toBe('stopped');
    expect(details.activeModels).toBe(0);
    expect(details.error).toBeDefined();
  });

  it('detects gateway healthy with active models', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.endsWith('/health')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: 'healthy' }),
        });
      }
      if (url.includes('/v1/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'pollinations/flux' }, { id: 'kilo/deepseek-r1' }],
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    let statusChangeFired: TrayStatus | null = null;
    const controller = new DesktopTrayController({
      fetchFn: mockFetch as unknown as typeof fetch,
      onStatusChange: (status) => {
        statusChangeFired = status;
      },
    });

    const details = await controller.checkGatewayHealth();
    expect(details.status).toBe('running');
    expect(details.activeModels).toBe(2);
    expect(statusChangeFired).toBe('running');
  });

  it('detects gateway degraded when healthy but 0 models available', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/health')) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      if (url.includes('/v1/models')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const controller = new DesktopTrayController({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const details = await controller.checkGatewayHealth();
    expect(details.status).toBe('degraded');
    expect(details.activeModels).toBe(0);
  });

  it('builds menu items according to status', () => {
    const controller = new DesktopTrayController();
    const stoppedMenu = controller.buildMenu({
      status: 'stopped',
      activeModels: 0,
      gatewayUrl: 'http://127.0.0.1:19808',
      dashboardUrl: 'http://127.0.0.1:3000',
      version: '0.5.0',
      lastChecked: new Date(),
    });

    const header = stoppedMenu.find((item) => item.id === 'header-status');
    expect(header?.label).toContain('Stopped');

    const claudeItem = stoppedMenu.find((item) => item.id === 'launch-claude');
    expect(claudeItem?.enabled).toBe(false);

    const toggleItem = stoppedMenu.find((item) => item.id === 'toggle-gateway');
    expect(toggleItem?.label).toBe('Start Gateway');

    const runningMenu = controller.buildMenu({
      status: 'running',
      activeModels: 42,
      gatewayUrl: 'http://127.0.0.1:19808',
      dashboardUrl: 'http://127.0.0.1:3000',
      version: '0.5.0',
      lastChecked: new Date(),
    });

    const runningHeader = runningMenu.find((item) => item.id === 'header-status');
    expect(runningHeader?.label).toContain('Active (42 models)');

    const runningClaudeItem = runningMenu.find((item) => item.id === 'launch-claude');
    expect(runningClaudeItem?.enabled).toBe(true);

    const runningToggleItem = runningMenu.find((item) => item.id === 'toggle-gateway');
    expect(runningToggleItem?.label).toBe('Restart Gateway');
  });

  it('triggers browser open and clipboard copy callbacks', async () => {
    let openedUrl = '';
    let copiedText = '';
    let notificationTitle = '';

    const controller = new DesktopTrayController({
      openUrlFn: async (url) => {
        openedUrl = url;
      },
      clipboardCopyFn: async (text) => {
        copiedText = text;
      },
      onNotification: (title) => {
        notificationTitle = title;
      },
    });

    const menu = controller.buildMenu();
    const playgroundItem = menu.find((item) => item.id === 'open-playground');
    await playgroundItem?.action?.();
    expect(openedUrl).toBe('http://127.0.0.1:3000/playground');

    const copyItem = menu.find((item) => item.id === 'copy-api-url');
    await copyItem?.action?.();
    expect(copiedText).toBe('http://127.0.0.1:19808/v1');
    expect(notificationTitle).toBe('Agent Nexus');
  });

  it('starts and stops polling timer cleanly', () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const controller = new DesktopTrayController({
      fetchFn: mockFetch as unknown as typeof fetch,
      pollIntervalMs: 1000,
    });

    controller.startPolling();
    // Starting twice should be idempotent
    controller.startPolling();
    controller.stopPolling();
    // Stopping twice should be idempotent
    controller.stopPolling();
  });
});
