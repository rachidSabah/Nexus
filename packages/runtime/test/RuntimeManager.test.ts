import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeManager } from '../src/services/RuntimeManager.js';

describe('RuntimeManager', () => {
  let runtime: RuntimeManager;

  beforeEach(() => {
    runtime = new RuntimeManager(1000);
  });

  it('should initialize with healthy state', () => {
    const state = runtime.getState();
    expect(state.health).toBe('healthy');
    expect(state.providers.size).toBe(0);
    expect(state.models.size).toBe(0);
  });

  it('should register and retrieve a provider', () => {
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      status: 'healthy' as const,
      lifecycle: 'running' as const,
      modelsCount: 5,
      activeConnections: 10,
      lastHealthCheck: new Date(),
      metadata: {}
    };

    runtime.registerProvider(provider);
    const retrieved = runtime.getProvider('test-provider');

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Test Provider');
  });

  it('should unregister a provider', () => {
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      status: 'healthy' as const,
      lifecycle: 'running' as const,
      modelsCount: 5,
      activeConnections: 10,
      lastHealthCheck: new Date(),
      metadata: {}
    };

    runtime.registerProvider(provider);
    runtime.unregisterProvider('test-provider');

    expect(runtime.getProvider('test-provider')).toBeUndefined();
  });

  it('should emit events on provider registration', () => {
    const eventHandler = vi.fn();
    runtime.on('provider:registered', eventHandler);

    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      status: 'healthy' as const,
      lifecycle: 'running' as const,
      modelsCount: 5,
      activeConnections: 10,
      lastHealthCheck: new Date(),
      metadata: {}
    };

    runtime.registerProvider(provider);

    expect(eventHandler).toHaveBeenCalledWith({
      providerId: 'test-provider',
      timestamp: expect.any(Date)
    });
  });

  it('should return runtime stats', () => {
    runtime.registerProvider({
      id: 'provider-1',
      name: 'Provider 1',
      status: 'healthy' as const,
      lifecycle: 'running' as const,
      modelsCount: 5,
      activeConnections: 10,
      lastHealthCheck: new Date(),
      metadata: {}
    });

    const stats = runtime.getStats();

    expect(stats.providersCount).toBe(1);
    expect(stats.health).toBe('healthy');
    expect(stats.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should update health to degraded when provider is unhealthy', () => {
    runtime.registerProvider({
      id: 'unhealthy-provider',
      name: 'Unhealthy Provider',
      status: 'unhealthy' as const,
      lifecycle: 'running' as const,
      modelsCount: 0,
      activeConnections: 0,
      lastHealthCheck: new Date(),
      metadata: {}
    });

    // Trigger health check manually
    (runtime as any).performHealthChecks();

    expect(runtime.getHealth()).toBe('unhealthy');
  });
});
