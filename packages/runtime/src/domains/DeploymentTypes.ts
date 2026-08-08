/**
 * Deployment Domain Types
 */

export type DeploymentStrategy = 'rolling' | 'blue-green' | 'canary' | 'recreate';
export type DeploymentState = 'pending' | 'deploying' | 'running' | 'failed' | 'rolled-back' | 'completed';

export interface DeploymentProfile {
  id: string;
  name: string;
  description?: string;
  target: 'local' | 'docker' | 'docker-compose' | 'kubernetes' | 'helm' | 'nomad' | 'systemd' | 'windows-service';
  strategy: DeploymentStrategy;
  config: DeploymentConfig;
  healthChecks: HealthCheck[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentConfig {
  replicas?: number;
  resources?: ResourceRequirements;
  scaling?: ScalingConfig;
  networking?: NetworkingConfig;
  storage?: StorageConfig;
  secrets?: SecretsConfig;
  monitoring?: MonitoringConfig;
}

export interface ResourceRequirements {
  cpu: string;
  memory: string;
  disk?: string;
}

export interface ScalingConfig {
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilization?: number;
  targetMemoryUtilization?: number;
  scaleUpCooldownSeconds?: number;
  scaleDownCooldownSeconds?: number;
}

export interface NetworkingConfig {
  port: number;
  hostNetwork?: boolean;
  ingress?: IngressConfig;
  loadBalancer?: LoadBalancerConfig;
}

export interface IngressConfig {
  enabled: boolean;
  host?: string;
  tls?: boolean;
  annotations?: Record<string, string>;
}

export interface LoadBalancerConfig {
  enabled: boolean;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  externalTrafficPolicy?: 'Cluster' | 'Local';
}

export interface StorageConfig {
  persistentVolumes: VolumeClaim[];
  ephemeralStorage?: string;
}

export interface VolumeClaim {
  name: string;
  size: string;
  accessModes: string[];
  storageClass?: string;
}

export interface SecretsConfig {
  secretStore?: 'kubernetes' | 'vault' | 'aws-secrets-manager' | 'azure-key-vault' | 'gcp-secret-manager';
  secretRefs: SecretRef[];
}

export interface SecretRef {
  name: string;
  key: string;
  envVar: string;
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  tracingEnabled: boolean;
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
  healthCheckPath: string;
  metricsPath: string;
}

export interface HealthCheck {
  type: 'http' | 'tcp' | 'exec';
  path?: string;
  port?: number;
  command?: string;
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
  successThreshold: number;
}

export interface RolloutConfig {
  strategy: DeploymentStrategy;
  canaryPercentage?: number;
  canarySteps?: CanaryStep[];
  blueGreenSwitch?: 'immediate' | 'gradual';
  rollbackOnFailure: boolean;
  verificationTimeoutSeconds: number;
}

export interface CanaryStep {
  percentage: number;
  pauseSeconds?: number;
  verification?: VerificationConfig;
}

export interface VerificationConfig {
  type: 'automated' | 'manual';
  metrics?: MetricVerification[];
  tests?: string[];
}

export interface MetricVerification {
  name: string;
  query: string;
  expectedValue: number;
  operator: 'lt' | 'lte' | 'eq' | 'gte' | 'gt';
}

export interface DeploymentRecord {
  id: string;
  profileId: string;
  status: DeploymentState;
  currentVersion: string;
  previousVersion?: string;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  rolledBackAt?: Date;
  progress: number;
  message?: string;
  history: DeploymentEvent[];
}

export interface DeploymentEvent {
  timestamp: Date;
  type: 'started' | 'progress' | 'health-check' | 'verification' | 'completed' | 'failed' | 'rolled-back';
  message: string;
  details?: Record<string, unknown>;
}
