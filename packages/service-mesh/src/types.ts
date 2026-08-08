/**
 * Service Mesh Types
 */

export type ServiceStatus = 'healthy' | 'unhealthy' | 'degraded' | 'unknown';

export interface ServiceInstance {
  id: string;
  name: string;
  address: string;
  port: number;
  status: ServiceStatus;
  metadata?: Record<string, string>;
  tags?: string[];
  lastHeartbeat?: number;
  weight?: number;
}

export interface GatewayInstance extends ServiceInstance {
  capabilities: string[];
  version: string;
  region?: string;
  zone?: string;
}

export interface ProviderInstance extends ServiceInstance {
  providerType: string;
  models: string[];
  streaming: boolean;
  embeddings: boolean;
  vision: boolean;
  toolCalling: boolean;
  latency?: number;
  costPerToken?: number;
}

export interface HealthCheckConfig {
  endpoint: string;
  interval: number;
  timeout: number;
  healthyThreshold: number;
  unhealthyThreshold: number;
}

export interface TrafficPolicy {
  loadBalancer?: LoadBalancerConfig;
  circuitBreaker?: CircuitBreakerConfig;
  retry?: RetryConfig;
  timeout?: TimeoutConfig;
  rateLimit?: RateLimitConfig;
}

export interface LoadBalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'sticky' | 'latency';
  stickySession?: {
    enabled: boolean;
    cookieName?: string;
    ttl?: number;
  };
  weights?: Record<string, number>;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenRequests: number;
}

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  factor: number;
  retryOn?: number[];
}

export interface TimeoutConfig {
  connect: number;
  request: number;
  idle: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  requestsPerSecond: number;
  burstSize: number;
}

export interface CanaryConfig {
  enabled: boolean;
  percentage: number;
  /** Tag used to identify canary instances. Defaults to 'canary'. */
  canaryTag?: string;
  headerMatch?: {
    name: string;
    value: string;
  };
}

export interface BlueGreenConfig {
  enabled: boolean;
  activeVersion: 'blue' | 'green';
  pendingVersion?: 'blue' | 'green';
}

export interface ServiceMeshConfig {
  serviceDiscovery: ServiceDiscoveryConfig;
  healthCheck: HealthCheckConfig;
  trafficPolicy: TrafficPolicy;
  canary?: CanaryConfig;
  blueGreen?: BlueGreenConfig;
}

export interface ServiceDiscoveryConfig {
  enabled: boolean;
  refreshInterval: number;
  dnsRefresh?: boolean;
  kubernetes?: {
    enabled: boolean;
    namespace?: string;
  };
}

export interface ServiceRegistrySnapshot {
  gateways: GatewayInstance[];
  providers: ProviderInstance[];
  timestamp: number;
  version: number;
}

export interface TrafficSplit {
  service: string;
  splits: Array<{
    destination: string;
    weight: number;
  }>;
}

export interface ConnectionDrainingConfig {
  enabled: boolean;
  timeout: number;
  maxConnections: number;
}

export interface RequestMirroringConfig {
  enabled: boolean;
  mirrorService: string;
  percentage: number;
}
