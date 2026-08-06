import type {
  ServiceInstance,
  GatewayInstance,
  ProviderInstance,
  LoadBalancerConfig,
  CircuitBreakerConfig,
  RetryConfig,
  TimeoutConfig,
} from './types';

export class LoadBalancer {
  private config: LoadBalancerConfig;
  private connectionCounts: Map<string, number> = new Map();
  private stickySessions: Map<string, string> = new Map();

  constructor(config: LoadBalancerConfig) {
    this.config = config;
  }

  select(
    instances: (GatewayInstance | ProviderInstance)[],
    stickyKey?: string
  ): (GatewayInstance | ProviderInstance) | null {
    if (instances.length === 0) return null;

    const healthyInstances = instances.filter((i) => i.status === 'healthy');
    if (healthyInstances.length === 0) return null;

    if (this.config.stickySession?.enabled && stickyKey) {
      const existingId = this.stickySessions.get(stickyKey);
      if (existingId) {
        const existing = healthyInstances.find((i) => i.id === existingId);
        if (existing) return existing;
      }

      const selected = this.selectByAlgorithm(healthyInstances);
      if (selected) {
        this.stickySessions.set(stickyKey, selected.id);
        const ttl = this.config.stickySession.ttl || 3600000;
        setTimeout(() => this.stickySessions.delete(stickyKey), ttl);
      }
      return selected;
    }

    return this.selectByAlgorithm(healthyInstances);
  }

  private selectByAlgorithm(
    instances: (GatewayInstance | ProviderInstance)[]
  ): (GatewayInstance | ProviderInstance) | null {
    switch (this.config.algorithm) {
      case 'round-robin':
        return this.roundRobin(instances);
      case 'least-connections':
        return this.leastConnections(instances);
      case 'weighted':
        return this.weighted(instances);
      case 'latency':
        return this.latencyBased(instances);
      default:
        return this.roundRobin(instances);
    }
  }

  private roundRobin(
    instances: (GatewayInstance | ProviderInstance)[]
  ): (GatewayInstance | ProviderInstance) {
    const index = Math.floor(Math.random() * instances.length);
    return instances[index] ?? null;
  }

  private leastConnections(
    instances: (GatewayInstance | ProviderInstance)[]
  ): (GatewayInstance | ProviderInstance) {
    let minConnections = Infinity;
    let selected: (GatewayInstance | ProviderInstance) | null = null;

    for (const instance of instances) {
      const connections = this.connectionCounts.get(instance.id) || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selected = instance;
      }
    }

    if (selected) {
      const current = this.connectionCounts.get(selected.id) || 0;
      this.connectionCounts.set(selected.id, current + 1);
    }

    return selected;
  }

  private weighted(
    instances: (GatewayInstance | ProviderInstance)[]
  ): (GatewayInstance | ProviderInstance) | null {
    const totalWeight = instances.reduce(
      (sum, instance) => sum + (instance.weight || 1),
      0
    );

    let random = Math.random() * totalWeight;
    for (const instance of instances) {
      const weight = instance.weight || 1;
      if (random < weight) {
        return instance;
      }
      random -= weight;
    }

    return instances[instances.length - 1] ?? null;
  }

  private latencyBased(
    instances: (GatewayInstance | ProviderInstance)[]
  ): (GatewayInstance | ProviderInstance) | null {
    const providers = instances.filter(
      (i): i is ProviderInstance => 'latency' in i && i.latency !== undefined
    );

    if (providers.length === 0) {
      return this.roundRobin(instances);
    }

    providers.sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity));
    return providers[0] ?? null;
  }

  releaseConnection(instanceId: string): void {
    const current = this.connectionCounts.get(instanceId) || 0;
    if (current > 0) {
      this.connectionCounts.set(instanceId, current - 1);
    }
  }

  updateConfig(config: Partial<LoadBalancerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LoadBalancerConfig {
    return { ...this.config };
  }
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenRequests: number = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  canExecute(): boolean {
    if (!this.config.enabled) return true;

    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.timeout) {
        this.state = 'half-open';
        this.halfOpenRequests = 0;
        return true;
      }
      return false;
    }

    if (this.state === 'half-open') {
      if (this.halfOpenRequests < this.config.halfOpenRequests) {
        this.halfOpenRequests++;
        return true;
      }
      return false;
    }

    return false;
  }

  recordSuccess(): void {
    if (!this.config.enabled) return;

    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    if (!this.config.enabled) return;

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.successCount = 0;
    } else if (
      this.state === 'closed' &&
      this.failureCount >= this.config.failureThreshold
    ) {
      this.state = 'open';
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
  }

  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export class RetryHandler {
  private config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry?: (error: Error) => boolean
  ): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }

    let lastError: Error | undefined;
    let delay = this.config.baseDelay;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.config.maxRetries) {
          break;
        }

        if (shouldRetry && !shouldRetry(lastError)) {
          throw lastError;
        }

        if (this.config.retryOn) {
          const status = (lastError as any).status;
          if (!this.config.retryOn.includes(status)) {
            throw lastError;
          }
        }

        await this.sleep(delay);
        delay = Math.min(delay * this.config.factor, this.config.maxDelay);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export class TimeoutManager {
  private config: TimeoutConfig;

  constructor(config: TimeoutConfig) {
    this.config = config;
  }

  withTimeout<T>(fn: () => Promise<T>, type: 'connect' | 'request' | 'idle'): Promise<T> {
    const timeout = this.config[type];
    
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${type} timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  updateConfig(config: Partial<TimeoutConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
