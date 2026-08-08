/**
 * Runtime Manager Service
 * 
 * Manages providers, models, plugins, workflows, integrations,
 * MCP servers, background workers, runtime state, lifecycle and health.
 */

import { EventEmitter } from 'events';

import type {
  RuntimeState,
  ProviderRuntime,
  ModelRuntime,
  PluginRuntime,
  WorkflowRuntime,
  MCPServerRuntime,
  WorkerRuntime,
  HealthStatus,
} from '../domains/RuntimeTypes.js';

export class RuntimeManager extends EventEmitter {
  private state: RuntimeState;
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly healthCheckIntervalMs: number;

  constructor(healthCheckIntervalMs: number = 30000) {
    super();
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.state = {
      providers: new Map(),
      models: new Map(),
      plugins: new Map(),
      workflows: new Map(),
      mcpServers: new Map(),
      workers: new Map(),
      startTime: new Date(),
      uptime: 0,
      health: 'healthy',
    };
  }

  /**
   * Start the runtime manager
   */
  async start(): Promise<void> {
    this.state.startTime = new Date();
    this.startHealthChecks();
    this.emit('runtime:started', { timestamp: new Date() });
  }

  /**
   * Stop the runtime manager
   */
  async stop(): Promise<void> {
    this.stopHealthChecks();
    await this.gracefulShutdown();
    this.emit('runtime:stopped', { timestamp: new Date() });
  }

  /**
   * Register a provider runtime
   */
  registerProvider(provider: ProviderRuntime): void {
    this.state.providers.set(provider.id, provider);
    this.emit('provider:registered', { providerId: provider.id, timestamp: new Date() });
    this.updateOverallHealth();
  }

  /**
   * Unregister a provider runtime
   */
  unregisterProvider(providerId: string): void {
    this.state.providers.delete(providerId);
    this.emit('provider:unregistered', { providerId, timestamp: new Date() });
    this.updateOverallHealth();
  }

  /**
   * Get provider runtime by ID
   */
  getProvider(providerId: string): ProviderRuntime | undefined {
    return this.state.providers.get(providerId);
  }

  /**
   * Get all provider runtimes
   */
  getAllProviders(): ProviderRuntime[] {
    return Array.from(this.state.providers.values());
  }

  /**
   * Register a model runtime
   */
  registerModel(model: ModelRuntime): void {
    this.state.models.set(model.id, model);
    this.emit('model:registered', { modelId: model.id, timestamp: new Date() });
  }

  /**
   * Get model runtime by ID
   */
  getModel(modelId: string): ModelRuntime | undefined {
    return this.state.models.get(modelId);
  }

  /**
   * Get all model runtimes
   */
  getAllModels(): ModelRuntime[] {
    return Array.from(this.state.models.values());
  }

  /**
   * Register a plugin runtime
   */
  registerPlugin(plugin: PluginRuntime): void {
    this.state.plugins.set(plugin.id, plugin);
    this.emit('plugin:registered', { pluginId: plugin.id, timestamp: new Date() });
  }

  /**
   * Enable/disable a plugin
   */
  togglePlugin(pluginId: string, enabled: boolean): void {
    const plugin = this.state.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = enabled;
      this.emit('plugin:toggled', { pluginId, enabled, timestamp: new Date() });
    }
  }

  /**
   * Get all plugin runtimes
   */
  getAllPlugins(): PluginRuntime[] {
    return Array.from(this.state.plugins.values());
  }

  /**
   * Register a workflow runtime
   */
  registerWorkflow(workflow: WorkflowRuntime): void {
    this.state.workflows.set(workflow.id, workflow);
    this.emit('workflow:registered', { workflowId: workflow.id, timestamp: new Date() });
  }

  /**
   * Update workflow execution stats
   */
  updateWorkflowStats(workflowId: string, activeExecutions: number): void {
    const workflow = this.state.workflows.get(workflowId);
    if (workflow) {
      workflow.activeExecutions = activeExecutions;
      workflow.totalExecutions += 1;
      workflow.lastExecution = new Date();
      this.emit('workflow:updated', { workflowId, timestamp: new Date() });
    }
  }

  /**
   * Get all workflow runtimes
   */
  getAllWorkflows(): WorkflowRuntime[] {
    return Array.from(this.state.workflows.values());
  }

  /**
   * Register an MCP server runtime
   */
  registerMCPServer(server: MCPServerRuntime): void {
    this.state.mcpServers.set(server.id, server);
    this.emit('mcp-server:registered', { serverId: server.id, timestamp: new Date() });
  }

  /**
   * Get MCP server runtime by ID
   */
  getMCPServer(serverId: string): MCPServerRuntime | undefined {
    return this.state.mcpServers.get(serverId);
  }

  /**
   * Get all MCP server runtimes
   */
  getAllMCPServers(): MCPServerRuntime[] {
    return Array.from(this.state.mcpServers.values());
  }

  /**
   * Register a worker runtime
   */
  registerWorker(worker: WorkerRuntime): void {
    this.state.workers.set(worker.id, worker);
    this.emit('worker:registered', { workerId: worker.id, timestamp: new Date() });
  }

  /**
   * Get worker runtime by ID
   */
  getWorker(workerId: string): WorkerRuntime | undefined {
    return this.state.workers.get(workerId);
  }

  /**
   * Get all worker runtimes
   */
  getAllWorkers(): WorkerRuntime[] {
    return Array.from(this.state.workers.values());
  }

  /**
   * Get current runtime state
   */
  getState(): RuntimeState {
    return {
      ...this.state,
      uptime: Date.now() - this.state.startTime.getTime(),
    };
  }

  /**
   * Get overall health status
   */
  getHealth(): HealthStatus {
    return this.state.health;
  }

  /**
   * Get runtime statistics
   */
  getStats(): RuntimeStats {
    return {
      providersCount: this.state.providers.size,
      modelsCount: this.state.models.size,
      pluginsCount: this.state.plugins.size,
      workflowsCount: this.state.workflows.size,
      mcpServersCount: this.state.mcpServers.size,
      workersCount: this.state.workers.size,
      uptime: Date.now() - this.state.startTime.getTime(),
      health: this.state.health,
    };
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckIntervalMs);
  }

  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  private performHealthChecks(): void {
    const unhealthyComponents: string[] = [];

    // Check providers
    for (const [id, provider] of this.state.providers) {
      if (provider.status === 'unhealthy' || provider.lifecycle === 'failed') {
        unhealthyComponents.push(`provider:${id}`);
      }
    }

    // Check MCP servers
    for (const [id, server] of this.state.mcpServers) {
      if (server.status === 'unhealthy') {
        unhealthyComponents.push(`mcp-server:${id}`);
      }
    }

    // Check workers
    for (const [id, worker] of this.state.workers) {
      if (worker.status === 'unhealthy' || worker.failedJobs > 10) {
        unhealthyComponents.push(`worker:${id}`);
      }
    }

    if (unhealthyComponents.length > 0) {
      this.emit('health:degraded', { unhealthyComponents, timestamp: new Date() });
    }

    this.updateOverallHealth();
  }

  private updateOverallHealth(): void {
    const allComponents = [
      ...Array.from(this.state.providers.values()),
      ...Array.from(this.state.mcpServers.values()),
      ...Array.from(this.state.workers.values()),
    ];

    const unhealthyCount = allComponents.filter(c => c.status === 'unhealthy').length;
    const degradedCount = allComponents.filter(c => c.status === 'degraded').length;

    if (unhealthyCount > 0) {
      this.state.health = 'unhealthy';
    } else if (degradedCount > 0) {
      this.state.health = 'degraded';
    } else {
      this.state.health = 'healthy';
    }
  }

  private async gracefulShutdown(): Promise<void> {
    // Set all components to stopping state
    const allComponents = [
      ...this.state.providers.values(),
      ...this.state.models.values(),
      ...this.state.plugins.values(),
      ...this.state.workflows.values(),
      ...this.state.mcpServers.values(),
      ...this.state.workers.values(),
    ];

    for (const component of allComponents) {
      component.lifecycle = 'stopping';
    }

    // Wait for active operations to complete (with timeout)
    await this.waitForActiveOperations(30000);

    // Set all components to stopped state
    for (const component of allComponents) {
      component.lifecycle = 'stopped';
    }
  }

  private async waitForActiveOperations(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const activeWorkflows = Array.from(this.state.workflows.values())
        .filter(w => w.activeExecutions > 0);
      
      const busyWorkers = Array.from(this.state.workers.values())
        .filter(w => w.queueSize > 0);

      if (activeWorkflows.length === 0 && busyWorkers.length === 0) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

export interface RuntimeStats {
  providersCount: number;
  modelsCount: number;
  pluginsCount: number;
  workflowsCount: number;
  mcpServersCount: number;
  workersCount: number;
  uptime: number;
  health: HealthStatus;
}
