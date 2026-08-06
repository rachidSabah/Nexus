/**
 * Runtime Domain Types
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type LifecycleState = 'starting' | 'running' | 'stopping' | 'stopped' | 'restarting' | 'failed';

export interface ProviderRuntime {
  id: string;
  name: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  modelsCount: number;
  activeConnections: number;
  lastHealthCheck: Date;
  metadata: Record<string, unknown>;
}

export interface ModelRuntime {
  id: string;
  providerId: string;
  name: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  contextWindow: number;
  maxOutput: number;
  capabilities: string[];
  currentLoad: number;
}

export interface PluginRuntime {
  id: string;
  name: string;
  version: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  enabled: boolean;
  dependencies: string[];
}

export interface WorkflowRuntime {
  id: string;
  name: string;
  version: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  activeExecutions: number;
  totalExecutions: number;
  lastExecution?: Date;
}

export interface MCPServerRuntime {
  id: string;
  name: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  connectedClients: number;
}

export interface WorkerRuntime {
  id: string;
  name: string;
  type: string;
  status: HealthStatus;
  lifecycle: LifecycleState;
  queueSize: number;
  processedJobs: number;
  failedJobs: number;
}

export interface RuntimeState {
  providers: Map<string, ProviderRuntime>;
  models: Map<string, ModelRuntime>;
  plugins: Map<string, PluginRuntime>;
  workflows: Map<string, WorkflowRuntime>;
  mcpServers: Map<string, MCPServerRuntime>;
  workers: Map<string, WorkerRuntime>;
  startTime: Date;
  uptime: number;
  health: HealthStatus;
}
