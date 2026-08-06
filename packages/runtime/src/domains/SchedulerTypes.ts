/**
 * Scheduler Domain Types
 */

export type OptimizationStrategy = 'latency' | 'cost' | 'availability' | 'balanced' | 'custom';
export type SchedulingStatus = 'pending' | 'scheduled' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface SchedulingInput {
  requestId: string;
  modelId?: string;
  capabilities?: string[];
  constraints?: SchedulingConstraints;
  preferences?: SchedulingPreferences;
  context?: RequestContext;
}

export interface SchedulingConstraints {
  maxLatencyMs?: number;
  maxCostPerToken?: number;
  minAvailability?: number;
  requiredCapabilities?: string[];
  excludedProviders?: string[];
  allowedRegions?: string[];
  requiredRegion?: string;
  maxContextWindow?: number;
  minContextWindow?: number;
}

export interface SchedulingPreferences {
  strategy: OptimizationStrategy;
  weights?: StrategyWeights;
  stickySession?: boolean;
  preferLocal?: boolean;
}

export interface StrategyWeights {
  latency?: number;
  cost?: number;
  availability?: number;
  quality?: number;
}

export interface RequestContext {
  userId?: string;
  organizationId?: string;
  projectId?: string;
  environment?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

export interface SchedulePlan {
  id: string;
  requestId: string;
  status: SchedulingStatus;
  selectedProvider: ProviderSelection;
  alternatives: ProviderSelection[];
  executionPlan: ExecutionPlan;
  createdAt: Date;
  expiresAt: Date;
  metrics: SchedulingMetrics;
}

export interface ProviderSelection {
  providerId: string;
  modelId: string;
  score: number;
  ranking: number;
  latencyEstimate: number;
  costEstimate: CostEstimate;
  availabilityScore: number;
  capabilityMatch: CapabilityMatch;
  region: string;
  healthStatus: string;
}

export interface CostEstimate {
  inputCostPerToken: number;
  outputCostPerToken: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  totalEstimatedCost: number;
  currency: string;
}

export interface CapabilityMatch {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  embeddings: boolean;
  responsesAPI: boolean;
  structuredOutput: boolean;
  audio: boolean;
  imageGeneration: boolean;
  matchScore: number;
  matchedCapabilities: string[];
  missingCapabilities: string[];
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  fallbacks: FallbackPlan[];
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  circuitBreakerConfig?: CircuitBreakerConfig;
}

export interface ExecutionStep {
  order: number;
  action: 'route' | 'transform' | 'validate' | 'cache-lookup' | 'cache-store' | 'log';
  target?: string;
  config?: Record<string, unknown>;
}

export interface FallbackPlan {
  triggerCondition: FallbackTrigger;
  alternativeProviders: ProviderSelection[];
  maxRetries: number;
}

export interface FallbackTrigger {
  type: 'error' | 'timeout' | 'rate-limit' | 'circuit-open' | 'health-degraded';
  errorPatterns?: string[];
  statusCodeRange?: [number, number];
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterEnabled: boolean;
  retryableErrors?: string[];
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenRequests: number;
}

export interface SchedulingMetrics {
  decisionTimeMs: number;
  providersEvaluated: number;
  modelsEvaluated: number;
  constraintsApplied: number;
  optimizationScore: number;
  predictedLatencyMs: number;
  predictedCostUSD: number;
}

export interface SchedulerConfig {
  defaultStrategy: OptimizationStrategy;
  evaluationTimeoutMs: number;
  maxAlternatives: number;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  healthCheckIntervalSeconds: number;
  loadBalancingEnabled: boolean;
  stickySessionDurationSeconds: number;
}

export interface SchedulerStats {
  totalRequests: number;
  scheduledRequests: number;
  failedSchedules: number;
  averageDecisionTimeMs: number;
  p95DecisionTimeMs: number;
  p99DecisionTimeMs: number;
  cacheHitRate: number;
  fallbackActivationRate: number;
  circuitBreakerTrips: number;
}
