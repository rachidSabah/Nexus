import { LoadBalancer, CircuitBreaker, RetryHandler, TimeoutManager } from './load-balancer';
import { ServiceRegistry } from './registry';
import type {
  ServiceMeshConfig,
  TrafficPolicy,
  GatewayInstance,
  ProviderInstance,
  ServiceStatus,
  CanaryConfig,
  BlueGreenConfig,
} from './types';

export class AIServiceMesh {
  private registry: ServiceRegistry;
  private loadBalancer: LoadBalancer;
  private circuitBreaker: CircuitBreaker;
  private retryHandler: RetryHandler;
  private timeoutManager: TimeoutManager;
  private config: ServiceMeshConfig;
  private canaryConfig?: CanaryConfig;
  private blueGreenConfig?: BlueGreenConfig;

  constructor(config: Partial<ServiceMeshConfig> = {}) {
    this.config = {
      serviceDiscovery: {
        enabled: true,
        refreshInterval: 30000,
        ...config.serviceDiscovery,
      },
      healthCheck: {
        endpoint: '/health',
        interval: 10000,
        timeout: 5000,
        healthyThreshold: 2,
        unhealthyThreshold: 3,
        ...config.healthCheck,
      },
      trafficPolicy: {
        loadBalancer: {
          algorithm: 'round-robin',
          ...config.trafficPolicy?.loadBalancer,
        },
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          successThreshold: 2,
          timeout: 30000,
          halfOpenRequests: 3,
          ...config.trafficPolicy?.circuitBreaker,
        },
        retry: {
          enabled: true,
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 5000,
          factor: 2,
          retryOn: [502, 503, 504],
          ...config.trafficPolicy?.retry,
        },
        timeout: {
          connect: 5000,
          request: 30000,
          idle: 60000,
          ...config.trafficPolicy?.timeout,
        },
        ...config.trafficPolicy,
      },
      canary: config.canary,
      blueGreen: config.blueGreen,
    };

    this.registry = new ServiceRegistry(this.config.healthCheck, this.config.serviceDiscovery);
    
    this.loadBalancer = new LoadBalancer(this.config.trafficPolicy.loadBalancer!);
    this.circuitBreaker = new CircuitBreaker(this.config.trafficPolicy.circuitBreaker!);
    this.retryHandler = new RetryHandler(this.config.trafficPolicy.retry!);
    this.timeoutManager = new TimeoutManager(this.config.trafficPolicy.timeout!);

    this.canaryConfig = config.canary;
    this.blueGreenConfig = config.blueGreen;
  }

  registerGateway(gateway: GatewayInstance): void {
    this.registry.registerGateway(gateway);
  }

  registerProvider(provider: ProviderInstance): void {
    this.registry.registerProvider(provider);
  }

  deregisterService(serviceId: string): boolean {
    return this.registry.deregister(serviceId);
  }

  updateServiceHealth(serviceId: string, status: ServiceStatus): boolean {
    return this.registry.updateServiceStatus(serviceId, status);
  }

  async routeToGateway(
    _request: any,
    stickyKey?: string
  ): Promise<GatewayInstance | null> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open');
    }

    const gateways = this.getAvailableGateways();
    if (gateways.length === 0) {
      throw new Error('No healthy gateways available');
    }

    const selected = this.loadBalancer.select(gateways, stickyKey);
    if (!selected) {
      throw new Error('Failed to select gateway');
    }

    try {
      await this.timeoutManager.withTimeout(
        async () => {
          // Execute the actual request here
          return Promise.resolve();
        },
        'request'
      );
      
      this.circuitBreaker.recordSuccess();
      return selected as GatewayInstance;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      throw error;
    } finally {
      this.loadBalancer.releaseConnection(selected.id);
    }
  }

  async routeToProvider(
    _request: any,
    stickyKey?: string
  ): Promise<ProviderInstance | null> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error('Circuit breaker is open');
    }

    const providers = this.getAvailableProviders();
    if (providers.length === 0) {
      throw new Error('No healthy providers available');
    }

    const selected = this.loadBalancer.select(providers, stickyKey);
    if (!selected) {
      throw new Error('Failed to select provider');
    }

    try {
      await this.timeoutManager.withTimeout(
        async () => {
          // Execute the actual request here
          return Promise.resolve();
        },
        'request'
      );
      
      this.circuitBreaker.recordSuccess();
      return selected as ProviderInstance;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      throw error;
    } finally {
      this.loadBalancer.releaseConnection(selected.id);
    }
  }

  getAvailableGateways(): GatewayInstance[] {
    return this.registry.getHealthyGateways();
  }

  getAvailableProviders(): ProviderInstance[] {
    return this.registry.getHealthyProviders();
  }

  getRegistrySnapshot() {
    return this.registry.getSnapshot();
  }

  getServiceCount() {
    return this.registry.getCount();
  }

  updateTrafficPolicy(policy: Partial<TrafficPolicy>): void {
    if (policy.loadBalancer) {
      this.loadBalancer.updateConfig(policy.loadBalancer);
      this.config.trafficPolicy.loadBalancer = {
        ...this.config.trafficPolicy.loadBalancer!,
        ...policy.loadBalancer,
      };
    }
    if (policy.circuitBreaker) {
      this.circuitBreaker.updateConfig(policy.circuitBreaker);
      this.config.trafficPolicy.circuitBreaker = {
        ...this.config.trafficPolicy.circuitBreaker!,
        ...policy.circuitBreaker,
      };
    }
    if (policy.retry) {
      this.retryHandler.updateConfig(policy.retry);
      this.config.trafficPolicy.retry = {
        ...this.config.trafficPolicy.retry!,
        ...policy.retry,
      };
    }
    if (policy.timeout) {
      this.timeoutManager.updateConfig(policy.timeout);
      this.config.trafficPolicy.timeout = {
        ...this.config.trafficPolicy.timeout!,
        ...policy.timeout,
      };
    }
  }

  enableCanary(percentage: number): void {
    this.canaryConfig = {
      enabled: true,
      percentage,
    };
  }

  disableCanary(): void {
    this.canaryConfig = undefined;
  }

  getCanaryConfig(): CanaryConfig | undefined {
    return this.canaryConfig;
  }

  switchBlueGreen(version: 'blue' | 'green'): void {
    if (!this.blueGreenConfig) {
      this.blueGreenConfig = {
        enabled: true,
        activeVersion: version,
      };
    } else {
      this.blueGreenConfig.activeVersion = version;
    }
  }

  getBlueGreenConfig(): BlueGreenConfig | undefined {
    return this.blueGreenConfig;
  }

  getConfig(): ServiceMeshConfig {
    return { ...this.config };
  }
}

export * from './types';
export { ServiceRegistry } from './registry';
export { LoadBalancer, CircuitBreaker, RetryHandler, TimeoutManager } from './load-balancer';
