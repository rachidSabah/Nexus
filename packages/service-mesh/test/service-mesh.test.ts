import { describe, it, expect, beforeEach } from 'vitest';
import { AIServiceMesh, ServiceRegistry, LoadBalancer, CircuitBreaker } from '../src';
import type { GatewayInstance, ProviderInstance, ServiceStatus } from '../src/types';

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  it('should register a gateway', () => {
    const gateway: GatewayInstance = {
      id: 'gw-1',
      name: 'Gateway 1',
      address: '192.168.1.1',
      port: 3000,
      status: 'healthy',
      capabilities: ['chat', 'completion'],
      version: '1.0.0',
    };

    registry.registerGateway(gateway);
    expect(registry.getGateway('gw-1')).toEqual(gateway);
  });

  it('should register a provider', () => {
    const provider: ProviderInstance = {
      id: 'prov-1',
      name: 'OpenAI Provider',
      address: 'api.openai.com',
      port: 443,
      status: 'healthy',
      providerType: 'openai',
      models: ['gpt-4', 'gpt-3.5-turbo'],
      streaming: true,
      embeddings: true,
      vision: true,
      toolCalling: true,
    };

    registry.registerProvider(provider);
    expect(registry.getProvider('prov-1')).toEqual(provider);
  });

  it('should return healthy gateways only', () => {
    const healthyGateway: GatewayInstance = {
      id: 'gw-1',
      name: 'Gateway 1',
      address: '192.168.1.1',
      port: 3000,
      status: 'healthy',
      capabilities: [],
      version: '1.0.0',
    };

    const unhealthyGateway: GatewayInstance = {
      id: 'gw-2',
      name: 'Gateway 2',
      address: '192.168.1.2',
      port: 3000,
      status: 'unhealthy',
      capabilities: [],
      version: '1.0.0',
    };

    registry.registerGateway(healthyGateway);
    registry.registerGateway(unhealthyGateway);

    const healthy = registry.getHealthyGateways();
    expect(healthy.length).toBe(1);
    expect(healthy[0].id).toBe('gw-1');
  });

  it('should update service health status', () => {
    const gateway: GatewayInstance = {
      id: 'gw-1',
      name: 'Gateway 1',
      address: '192.168.1.1',
      port: 3000,
      status: 'healthy',
      capabilities: [],
      version: '1.0.0',
    };

    registry.registerGateway(gateway);
    registry.updateServiceStatus('gw-1', 'unhealthy');

    const updated = registry.getGateway('gw-1');
    expect(updated?.status).toBe('unhealthy');
  });

  it('should deregister a service', () => {
    const gateway: GatewayInstance = {
      id: 'gw-1',
      name: 'Gateway 1',
      address: '192.168.1.1',
      port: 3000,
      status: 'healthy',
      capabilities: [],
      version: '1.0.0',
    };

    registry.registerGateway(gateway);
    const removed = registry.deregister('gw-1');

    expect(removed).toBe(true);
    expect(registry.getGateway('gw-1')).toBeUndefined();
  });
});

describe('LoadBalancer', () => {
  it('should select instance using round-robin', () => {
    const lb = new LoadBalancer({ algorithm: 'round-robin' });
    const instances: ProviderInstance[] = [
      {
        id: 'p1',
        name: 'Provider 1',
        address: '1.1.1.1',
        port: 443,
        status: 'healthy',
        providerType: 'openai',
        models: ['gpt-4'],
        streaming: true,
        embeddings: false,
        vision: false,
        toolCalling: false,
      },
      {
        id: 'p2',
        name: 'Provider 2',
        address: '2.2.2.2',
        port: 443,
        status: 'healthy',
        providerType: 'anthropic',
        models: ['claude-3'],
        streaming: true,
        embeddings: false,
        vision: true,
        toolCalling: true,
      },
    ];

    const selected = lb.select(instances);
    expect(selected).toBeTruthy();
    expect(['p1', 'p2']).toContain(selected!.id);
  });

  it('should filter out unhealthy instances', () => {
    const lb = new LoadBalancer({ algorithm: 'round-robin' });
    const instances: ProviderInstance[] = [
      {
        id: 'p1',
        name: 'Provider 1',
        address: '1.1.1.1',
        port: 443,
        status: 'unhealthy',
        providerType: 'openai',
        models: ['gpt-4'],
        streaming: true,
        embeddings: false,
        vision: false,
        toolCalling: false,
      },
      {
        id: 'p2',
        name: 'Provider 2',
        address: '2.2.2.2',
        port: 443,
        status: 'healthy',
        providerType: 'anthropic',
        models: ['claude-3'],
        streaming: true,
        embeddings: false,
        vision: true,
        toolCalling: true,
      },
    ];

    const selected = lb.select(instances);
    expect(selected?.id).toBe('p2');
  });

  it('should return null when no healthy instances', () => {
    const lb = new LoadBalancer({ algorithm: 'round-robin' });
    const instances: ProviderInstance[] = [
      {
        id: 'p1',
        name: 'Provider 1',
        address: '1.1.1.1',
        port: 443,
        status: 'unhealthy',
        providerType: 'openai',
        models: ['gpt-4'],
        streaming: true,
        embeddings: false,
        vision: false,
        toolCalling: false,
      },
    ];

    const selected = lb.select(instances);
    expect(selected).toBeNull();
  });
});

describe('CircuitBreaker', () => {
  it('should start in closed state', () => {
    const cb = new CircuitBreaker({
      enabled: true,
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000,
      halfOpenRequests: 1,
    });

    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('should open after reaching failure threshold', () => {
    const cb = new CircuitBreaker({
      enabled: true,
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 30000,
      halfOpenRequests: 1,
    });

    for (let i = 0; i < 3; i++) {
      cb.recordFailure();
    }

    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('should transition to half-open after timeout', async () => {
    const cb = new CircuitBreaker({
      enabled: true,
      failureThreshold: 1,
      successThreshold: 1,
      timeout: 100,
      halfOpenRequests: 1,
    });

    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('should close after successful requests in half-open state', async () => {
    const cb = new CircuitBreaker({
      enabled: true,
      failureThreshold: 1,
      successThreshold: 2,
      timeout: 100,
      halfOpenRequests: 3,
    });

    cb.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Trigger half-open state
    cb.canExecute();
    
    cb.recordSuccess();
    cb.recordSuccess();

    expect(cb.getState()).toBe('closed');
  });
});

describe('AIServiceMesh', () => {
  let mesh: AIServiceMesh;

  beforeEach(() => {
    mesh = new AIServiceMesh();
  });

  it('should initialize with default configuration', () => {
    const config = mesh.getConfig();
    expect(config.serviceDiscovery.enabled).toBe(true);
    expect(config.trafficPolicy.circuitBreaker?.enabled).toBe(true);
    expect(config.trafficPolicy.retry?.enabled).toBe(true);
  });

  it('should register and route to gateways', () => {
    const gateway: GatewayInstance = {
      id: 'gw-1',
      name: 'Gateway 1',
      address: '192.168.1.1',
      port: 3000,
      status: 'healthy',
      capabilities: ['chat'],
      version: '1.0.0',
    };

    mesh.registerGateway(gateway);
    const available = mesh.getAvailableGateways();

    expect(available.length).toBe(1);
    expect(available[0].id).toBe('gw-1');
  });

  it('should register and route to providers', () => {
    const provider: ProviderInstance = {
      id: 'prov-1',
      name: 'OpenAI',
      address: 'api.openai.com',
      port: 443,
      status: 'healthy',
      providerType: 'openai',
      models: ['gpt-4'],
      streaming: true,
      embeddings: true,
      vision: true,
      toolCalling: true,
    };

    mesh.registerProvider(provider);
    const available = mesh.getAvailableProviders();

    expect(available.length).toBe(1);
    expect(available[0].id).toBe('prov-1');
  });

  it('should enable canary deployments', () => {
    mesh.enableCanary(10);
    const canaryConfig = mesh.getCanaryConfig();

    expect(canaryConfig).toBeDefined();
    expect(canaryConfig?.enabled).toBe(true);
    expect(canaryConfig?.percentage).toBe(10);
  });

  it('should switch blue-green deployments', () => {
    mesh.switchBlueGreen('blue');
    expect(mesh.getBlueGreenConfig()?.activeVersion).toBe('blue');

    mesh.switchBlueGreen('green');
    expect(mesh.getBlueGreenConfig()?.activeVersion).toBe('green');
  });

  it('should update traffic policy', () => {
    mesh.updateTrafficPolicy({
      loadBalancer: { algorithm: 'least-connections' },
      retry: { enabled: false },
    });

    const config = mesh.getConfig();
    expect(config.trafficPolicy.loadBalancer?.algorithm).toBe('least-connections');
    expect(config.trafficPolicy.retry?.enabled).toBe(false);
  });
});
