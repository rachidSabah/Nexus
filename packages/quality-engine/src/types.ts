/**
 * Quality Engine Type Definitions
 */

export interface CertificationReport {
  version: string;
  timestamp: Date;
  overall: 'PASS' | 'FAIL' | 'WARNING';
  categories: {
    compatibility?: CompatibilityResult;
    provider?: ProviderCertificationResult;
    conformance?: ConformanceResult;
    performance?: BenchmarkMetrics;
    load?: LoadTestResult;
    chaos?: ChaosResult;
    security?: SecurityAuditResult;
  };
  summary: string;
  recommendations: string[];
}

export interface CompatibilityResult {
  tools: Array<{
    name: string;
    version: string;
    status: 'COMPATIBLE' | 'PARTIAL' | 'INCOMPATIBLE';
    issues: string[];
  }>;
  editors: Array<{
    name: string;
    status: 'COMPATIBLE' | 'PARTIAL' | 'INCOMPATIBLE';
    extensions: string[];
  }>;
}

export interface ProviderCertificationResult {
  providers: Array<{
    name: string;
    capabilities: {
      streaming: boolean;
      embeddings: boolean;
      vision: boolean;
      toolCalling: boolean;
      structuredOutput: boolean;
      responsesAPI: boolean;
    };
    reliability: {
      retryBehavior: 'PASS' | 'FAIL';
      rateLimitHandling: 'PASS' | 'FAIL';
      timeoutHandling: 'PASS' | 'FAIL';
      healthMonitoring: 'PASS' | 'FAIL';
    };
    score: number;
  }>;
}

export interface ConformanceResult {
  openAICompatibility: {
    streaming: boolean;
    jsonSchema: boolean;
    httpStatusCodes: boolean;
    authentication: boolean;
    headers: boolean;
    pagination: boolean;
    errors: boolean;
    webSocket: boolean;
    sse: boolean;
  };
  compliance: number;
}

export interface BenchmarkMetrics {
  latency: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  memory: {
    average: number;
    peak: number;
  };
  cpu: {
    average: number;
    peak: number;
  };
  throughput: {
    requestsPerSecond: number;
    tokensPerSecond: number;
  };
  cachePerformance: {
    hitRate: number;
    missRate: number;
  };
}

export interface LoadTestResult {
  users: number;
  providers: number;
  duration: number;
  successRate: number;
  errorRate: number;
  avgLatency: number;
  maxConcurrent: number;
  totalTokens: number;
}

export interface ChaosResult {
  scenarios: Array<{
    name: string;
    type: string;
    status: 'SURVIVED' | 'FAILED';
    recoveryTime?: number;
    dataLoss: boolean;
  }>;
  resilienceScore: number;
}

export interface SecurityAuditResult {
  dependencyAudit: {
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
  sbomGenerated: boolean;
  secretScanning: {
    secretsFound: number;
    locations: string[];
  };
  staticAnalysis: {
    issues: number;
    critical: number;
  };
  containerScan: {
    vulnerabilities: number;
    passed: boolean;
  };
}

export interface ReleaseConfig {
  version: string;
  changelog: string;
  migrationScripts: string[];
  rollbackPlan: string;
  signingKey?: string;
  targetPlatforms: string[];
}

export interface ChaosScenario {
  name: string;
  type: 'PROVIDER_FAILURE' | 'NETWORK_FAILURE' | 'DNS_FAILURE' | 
        'CACHE_FAILURE' | 'CLUSTER_FAILURE' | 'DASHBOARD_FAILURE' |
        'WORKER_FAILURE' | 'DISK_FULL' | 'MEMORY_PRESSURE';
  duration: number;
  target?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
