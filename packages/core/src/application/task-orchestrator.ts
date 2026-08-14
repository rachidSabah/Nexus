import { randomUUID } from 'node:crypto';
import { type AgentTask, type TaskCategory, type TaskPriority } from '../domain/orchestration.js';
import { TaskClassifier } from './task-classifier.js';
import { AgentSelector, type AgentCandidate } from './agent-selector.js';
import { type RoutingEnginePort } from './ports.js';
import { type EventBusPort } from './ports.js';
import { type TaskStorePort } from './task-store.js';
import { type AgentExecutorPort } from './agent-executor.js';

export interface CreateTaskOptions {
  prompt: string;
  category?: TaskCategory;
  requestedAgent?: string;
  requestedModel?: string;
  priority?: TaskPriority;
  timeoutMs?: number;
  workingDirectory?: string;
  dryRun?: boolean;
}

export class TaskOrchestrator {
  private readonly classifier = new TaskClassifier();
  private readonly selector = new AgentSelector();

  constructor(
    private readonly routingEngine: RoutingEnginePort,
    private readonly taskStore: TaskStorePort,
    private readonly executor: AgentExecutorPort,
    private readonly eventBus?: EventBusPort
  ) {}

  async planTask(
    opts: CreateTaskOptions,
    availableAgents: readonly AgentCandidate[]
  ) {
    // 1. Task Classification
    const taskType = opts.category
      ? opts.category.toLowerCase()
      : this.classifier.classify({ model: 'nexus/auto', messages: [{ role: 'user', content: opts.prompt }] }).type;

    const category: TaskCategory = (taskType.toUpperCase() as TaskCategory) || 'GENERAL';

    // 2. Autonomous Agent Selection
    const selection = this.selector.selectAgent(availableAgents, {
      category,
      preferredAgent: opts.requestedAgent,
    });

    // 3. Autonomous Model Selection
    const policyModel = opts.requestedModel ?? (category === 'CODING' || category === 'DEBUGGING' ? 'nexus/best-coding' : 'nexus/auto');
    const decision = await this.routingEngine.resolve({
      model: policyModel,
    });

    return {
      category,
      selectedAgent: selection.selectedAgent,
      agentScore: selection.score,
      agentReasons: selection.reasons,
      selectedModel: decision.endpoint.id,
      providerId: decision.endpoint.providerId,
      policy: policyModel,
      alternatives: selection.alternatives,
    };
  }

  async createTask(
    opts: CreateTaskOptions,
    availableAgents: readonly AgentCandidate[]
  ): Promise<AgentTask> {
    const plan = await this.planTask(opts, availableAgents);

    const task: AgentTask = {
      taskId: `task-${randomUUID().substring(0, 8)}`,
      status: opts.dryRun ? 'PLANNING' : 'QUEUED',
      prompt: opts.prompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      priority: opts.priority ?? 'NORMAL',
      category: plan.category,
      requestedAgent: opts.requestedAgent,
      selectedAgent: plan.selectedAgent,
      requestedModel: opts.requestedModel,
      selectedModel: plan.selectedModel,
      provider: plan.providerId,
      executionAttempts: 0,
      timeoutMs: opts.timeoutMs ?? 60000,
      workingDirectory: opts.workingDirectory,
    };

    await this.taskStore.save(task);

    this.eventBus?.publish({
      type: 'task.created',
      occurredAt: new Date(),
      payload: {
        taskId: task.taskId,
        prompt: task.prompt,
        category: task.category,
        priority: task.priority,
        timestamp: task.createdAt,
      },
    });

    return task;
  }

  async executeTask(
    taskId: string,
    agentExecutable: string,
    gatewayUrl: string
  ): Promise<AgentTask> {
    const task = await this.taskStore.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    task.status = 'RUNNING';
    task.executionAttempts += 1;
    task.updatedAt = Date.now();
    await this.taskStore.save(task);

    this.eventBus?.publish({
      type: 'task.execution.started',
      occurredAt: new Date(),
      payload: {
        taskId: task.taskId,
        runId: `run-${randomUUID().substring(0, 8)}`,
        agentId: task.selectedAgent ?? 'claude-code',
        modelId: task.selectedModel ?? 'nexus/auto',
        attempt: task.executionAttempts,
      },
    });

    const startTime = Date.now();
    const res = await this.executor.execute(task, agentExecutable, {
      gatewayUrl,
      modelId: task.selectedModel ?? 'nexus/auto',
    });

    if (res.exitCode === 0) {
      task.status = 'COMPLETED';
      task.result = { output: res.output, stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode };
      this.eventBus?.publish({
        type: 'task.execution.completed',
        occurredAt: new Date(),
        payload: {
          taskId: task.taskId,
          runId: `run-${randomUUID().substring(0, 8)}`,
          agentId: task.selectedAgent ?? 'claude-code',
          modelId: task.selectedModel ?? 'nexus/auto',
          durationMs: Date.now() - startTime,
        },
      });
    } else {
      task.status = 'FAILED';
      task.error = { code: 'EXEC_ERROR', message: res.output };
      this.eventBus?.publish({
        type: 'task.execution.failed',
        occurredAt: new Date(),
        payload: {
          taskId: task.taskId,
          runId: `run-${randomUUID().substring(0, 8)}`,
          agentId: task.selectedAgent ?? 'claude-code',
          error: res.output,
          willRetry: false,
        },
      });
    }

    task.updatedAt = Date.now();
    await this.taskStore.save(task);
    return task;
  }

  async cancelTask(taskId: string): Promise<AgentTask> {
    const task = await this.taskStore.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    if (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELLED') {
      return task;
    }

    task.status = 'CANCELLED';
    task.updatedAt = Date.now();
    await this.taskStore.save(task);

    this.eventBus?.publish({
      type: 'task.cancelled',
      occurredAt: new Date(),
      payload: {
        taskId: task.taskId,
        timestamp: task.updatedAt,
      },
    });

    return task;
  }

  async retryTask(
    taskId: string,
    agentExecutable: string,
    gatewayUrl: string
  ): Promise<AgentTask> {
    const task = await this.taskStore.get(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);

    task.status = 'RETRYING';
    task.updatedAt = Date.now();
    await this.taskStore.save(task);

    return this.executeTask(taskId, agentExecutable, gatewayUrl);
  }
}
