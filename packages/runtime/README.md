# @agent-nexus/runtime

AI Runtime Manager for Agent Nexus Gateway v0.8.0

## Overview

The Runtime Manager is responsible for managing all runtime components of the Agent Nexus Gateway, including:

- **Providers**: AI provider lifecycle and health monitoring
- **Models**: Model registration and status tracking
- **Plugins**: Plugin management and enablement
- **Workflows**: Workflow execution tracking
- **MCP Servers**: MCP server registration and monitoring
- **Workers**: Background worker management
- **Health**: Overall system health monitoring

## Features

- Real-time component registration and discovery
- Health checking with automatic status updates
- Graceful shutdown handling
- Event-driven architecture
- Lifecycle management (start, stop, restart)
- Statistics and metrics collection

## Installation

```bash
pnpm add @agent-nexus/runtime
```

## Usage

```typescript
import { RuntimeManager } from '@agent-nexus/runtime';

const runtime = new RuntimeManager(30000); // 30s health check interval

// Start the runtime manager
await runtime.start();

// Register a provider
runtime.registerProvider({
  id: 'openai-provider',
  name: 'OpenAI Provider',
  status: 'healthy',
  lifecycle: 'running',
  modelsCount: 5,
  activeConnections: 10,
  lastHealthCheck: new Date(),
  metadata: {}
});

// Get runtime statistics
const stats = runtime.getStats();
console.log(stats);

// Listen for events
runtime.on('provider:registered', (event) => {
  console.log('Provider registered:', event);
});

// Stop the runtime manager
await runtime.stop();
```

## Events

- `runtime:started` - Runtime manager started
- `runtime:stopped` - Runtime manager stopped
- `provider:registered` - Provider registered
- `provider:unregistered` - Provider unregistered
- `model:registered` - Model registered
- `plugin:registered` - Plugin registered
- `plugin:toggled` - Plugin enabled/disabled
- `workflow:registered` - Workflow registered
- `workflow:updated` - Workflow stats updated
- `mcp-server:registered` - MCP server registered
- `worker:registered` - Worker registered
- `health:degraded` - System health degraded

## API Reference

### RuntimeManager

#### Methods

- `start()` - Start the runtime manager
- `stop()` - Stop the runtime manager with graceful shutdown
- `registerProvider(provider)` - Register a provider runtime
- `unregisterProvider(providerId)` - Unregister a provider
- `getProvider(providerId)` - Get provider by ID
- `getAllProviders()` - Get all providers
- `registerModel(model)` - Register a model runtime
- `getModel(modelId)` - Get model by ID
- `getAllModels()` - Get all models
- `registerPlugin(plugin)` - Register a plugin runtime
- `togglePlugin(pluginId, enabled)` - Enable/disable plugin
- `getAllPlugins()` - Get all plugins
- `registerWorkflow(workflow)` - Register a workflow runtime
- `updateWorkflowStats(workflowId, activeExecutions)` - Update workflow stats
- `getAllWorkflows()` - Get all workflows
- `registerMCPServer(server)` - Register an MCP server
- `getMCPServer(serverId)` - Get MCP server by ID
- `getAllMCPServers()` - Get all MCP servers
- `registerWorker(worker)` - Register a worker runtime
- `getWorker(workerId)` - Get worker by ID
- `getAllWorkers()` - Get all workers
- `getState()` - Get current runtime state
- `getHealth()` - Get overall health status
- `getStats()` - Get runtime statistics

## License

MIT
