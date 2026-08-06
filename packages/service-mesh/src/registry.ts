import { EventEmitter } from 'events';
import type {
  ServiceInstance,
  GatewayInstance,
  ProviderInstance,
  ServiceStatus,
  HealthCheckConfig,
  ServiceDiscoveryConfig,
  ServiceRegistrySnapshot,
} from './types';

interface ServiceEvents {
  registered: (service: ServiceInstance) => void;
  deregistered: (serviceId: string) => void;
  healthChanged: (serviceId: string, status: ServiceStatus) => void;
  updated: (service: ServiceInstance) => void;
}

export class ServiceRegistry extends EventEmitter<ServiceEvents> {
  private gateways: Map<string, GatewayInstance> = new Map();
  private providers: Map<string, ProviderInstance> = new Map();
  private healthCheckConfig: HealthCheckConfig;
  private discoveryConfig: ServiceDiscoveryConfig;
  private version: number = 0;

  constructor(
    healthCheckConfig?: Partial<HealthCheckConfig>,
    discoveryConfig?: Partial<ServiceDiscoveryConfig>
  ) {
    super();
    this.healthCheckConfig = {
      endpoint: '/health',
      interval: 10000,
      timeout: 5000,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      ...healthCheckConfig,
    };
    this.discoveryConfig = {
      enabled: true,
      refreshInterval: 30000,
      dnsRefresh: false,
      ...discoveryConfig,
    };
  }

  registerGateway(gateway: GatewayInstance): void {
    this.gateways.set(gateway.id, gateway);
    this.version++;
    this.emit('registered', gateway);
  }

  registerProvider(provider: ProviderInstance): void {
    this.providers.set(provider.id, provider);
    this.version++;
    this.emit('registered', provider);
  }

  deregister(serviceId: string): boolean {
    const removedGateway = this.gateways.delete(serviceId);
    const removedProvider = this.providers.delete(serviceId);
    
    if (removedGateway || removedProvider) {
      this.version++;
      this.emit('deregistered', serviceId);
      return true;
    }
    return false;
  }

  updateServiceStatus(serviceId: string, status: ServiceStatus): boolean {
    const gateway = this.gateways.get(serviceId);
    if (gateway) {
      const oldStatus = gateway.status;
      gateway.status = status;
      gateway.lastHeartbeat = Date.now();
      this.emit('updated', gateway);
      if (oldStatus !== status) {
        this.emit('healthChanged', serviceId, status);
      }
      return true;
    }

    const provider = this.providers.get(serviceId);
    if (provider) {
      const oldStatus = provider.status;
      provider.status = status;
      provider.lastHeartbeat = Date.now();
      this.emit('updated', provider);
      if (oldStatus !== status) {
        this.emit('healthChanged', serviceId, status);
      }
      return true;
    }

    return false;
  }

  getGateway(id: string): GatewayInstance | undefined {
    return this.gateways.get(id);
  }

  getProvider(id: string): ProviderInstance | undefined {
    return this.providers.get(id);
  }

  getAllGateways(): GatewayInstance[] {
    return Array.from(this.gateways.values());
  }

  getAllProviders(): ProviderInstance[] {
    return Array.from(this.providers.values());
  }

  getHealthyGateways(): GatewayInstance[] {
    return this.getAllGateways().filter((g) => g.status === 'healthy');
  }

  getHealthyProviders(): ProviderInstance[] {
    return this.getAllProviders().filter((p) => p.status === 'healthy');
  }

  getServicesByTag(tag: string): ServiceInstance[] {
    const gatewayMatches = this.getAllGateways().filter(
      (g) => g.tags?.includes(tag)
    );
    const providerMatches = this.getAllProviders().filter(
      (p) => p.tags?.includes(tag)
    );
    return [...gatewayMatches, ...providerMatches];
  }

  getSnapshot(): ServiceRegistrySnapshot {
    return {
      gateways: this.getAllGateways(),
      providers: this.getAllProviders(),
      timestamp: Date.now(),
      version: this.version,
    };
  }

  getVersion(): number {
    return this.version;
  }

  getCount(): { gateways: number; providers: number; total: number } {
    return {
      gateways: this.gateways.size,
      providers: this.providers.size,
      total: this.gateways.size + this.providers.size,
    };
  }

  clear(): void {
    this.gateways.clear();
    this.providers.clear();
    this.version++;
  }
}
