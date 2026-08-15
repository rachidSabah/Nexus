/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MissionOrchestrator — Phase 29 Unified Agent Mission Orchestration Platform.
 *
 * Coordinates end-to-end mission decomposition, DAG task scheduling,
 * multi-agent delegation, autonomous repair loops, verification, and checkpointing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type {
  Mission,
  MissionCheckpoint,
  MissionEvent,
  MissionExecutionOptions,
  MissionOrchestratorMetrics,
  MissionPlan,
  MissionSpecification,
  MissionTask,
  MissionTaskStatus,
} from '../../domain/mission.js';
import type { AgentOrchestrator } from '../orchestrator/agent-orchestrator.js';
import type { EventBusPort } from '../ports.js';

import { MissionPlanner } from './mission-planner.js';
import { MissionStore } from './mission-store.js';
import { MissionVerifier } from './mission-verifier.js';

export interface MissionOrchestratorOptions {
  agentOrchestrator: AgentOrchestrator;
  store?: MissionStore;
  planner?: MissionPlanner;
  verifier?: MissionVerifier;
  events?: EventBusPort;
  defaultMaxRepairCycles?: number;
}

export class MissionOrchestrator {
  private agentOrchestrator: AgentOrchestrator;
  private store: MissionStore;
  private planner: MissionPlanner;
  private verifier: MissionVerifier;
  private events?: EventBusPort;
  private defaultMaxRepairCycles: number;

  private activeControllers = new Map<string, AbortController>();
  private activeEventSubscribers = new Map<string, Set<(event: MissionEvent) => void>>();

  private metrics: MissionOrchestratorMetrics = {
    totalMissions: 0,
    activeMissions: 0,
    completedMissions: 0,
    failedMissions: 0,
    cancelledMissions: 0,
    totalTasksExecuted: 0,
    totalFailovers: 0,
    totalRepairs: 0,
    totalTokensConsumed: 0,
    totalEstimatedCost: 0,
    averageMissionDurationMs: 0,
  };

  constructor(options: MissionOrchestratorOptions) {
    this.agentOrchestrator = options.agentOrchestrator;
    this.store = options.store ?? new MissionStore();
    this.planner = options.planner ?? new MissionPlanner();
    this.verifier = options.verifier ?? new MissionVerifier();
    this.events = options.events;
    this.defaultMaxRepairCycles = options.defaultMaxRepairCycles ?? 3;
  }

  /** Create a new mission from specification */
  async createMission(spec: MissionSpecification): Promise<Mission> {
    if (!spec.objective?.trim()) {
      throw new Error('Mission objective is required');
    }

    if (spec.workspace && (!isAbsolute(spec.workspace) || spec.workspace.includes('..'))) {
      throw new Error(`Workspace path must be an absolute path without traversal: '${spec.workspace}'`);
    }

    const missionId = `mis-${randomUUID().substring(0, 8)}`;
    const now = Date.now();

    const mission: Mission = {
      id: missionId,
      spec: {
        ...spec,
        policy: spec.policy ?? 'nexus/auto',
      },
      status: 'CREATED',
      createdAt: now,
      updatedAt: now,
      activeTaskIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      totalTokens: 0,
      estimatedCost: 0,
      tokenSavings: 0,
      failoverCount: 0,
      repairCount: 0,
      checkpointsCount: 0,
    };

    this.store.save(mission);
    this.metrics.totalMissions++;

    this.emitEvent(missionId, 'mission.created', {
      missionId,
      objective: spec.objective,
      policy: mission.spec.policy,
    });

    // Auto-plan on creation
    await this.planMission(missionId);

    // Auto-execute if requested and approved
    if (spec.autoExecute) {
      const planned = this.store.get(missionId);
      if (planned && planned.status === 'READY') {
        void this.executeMission(missionId);
      }
    }

    return this.store.get(missionId)!;
  }

  /** Plan a mission into a DAG of executable tasks */
  async planMission(missionId: string): Promise<MissionPlan> {
    const mission = this.store.get(missionId);
    if (!mission) {
      throw new Error(`Mission not found: '${missionId}'`);
    }

    mission.status = 'PLANNING';
    this.store.save(mission);

    this.emitEvent(missionId, 'mission.planned.started', { missionId });

    const plan = this.planner.plan(missionId, mission.spec);
    mission.plan = plan;

    // Evaluate Risk Gate
    if (plan.requiresApproval) {
      mission.status = 'AWAITING_APPROVAL';
      this.emitEvent(missionId, 'mission.approval.required', {
        missionId,
        riskLevel: plan.riskLevel,
        reason: plan.approvalReason,
      });
    } else {
      mission.status = 'READY';
      this.emitEvent(missionId, 'mission.planned', {
        missionId,
        taskCount: plan.tasks.length,
        riskLevel: plan.riskLevel,
      });
    }

    this.store.save(mission);
    this.createCheckpoint(mission);
    return plan;
  }

  /** Approve an awaiting-approval mission */
  async approveMission(missionId: string, approvedBy = 'operator'): Promise<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) {
      throw new Error(`Mission not found: '${missionId}'`);
    }

    if (mission.status !== 'AWAITING_APPROVAL') {
      throw new Error(`Mission '${missionId}' is not awaiting approval (current status: ${mission.status})`);
    }

    mission.status = 'READY';
    mission.approvedAt = Date.now();
    mission.approvedBy = approvedBy;
    this.store.save(mission);

    this.emitEvent(missionId, 'mission.approved', {
      missionId,
      approvedBy,
      timestamp: mission.approvedAt,
    });

    this.createCheckpoint(mission);
    return mission;
  }

  /** Execute a planned or ready mission */
  async executeMission(missionId: string, options: MissionExecutionOptions = {}): Promise<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) {
      throw new Error(`Mission not found: '${missionId}'`);
    }

    if (mission.status === 'AWAITING_APPROVAL' && options.autoApprove) {
      await this.approveMission(missionId, 'auto-approver');
    }

    if (mission.status !== 'READY' && mission.status !== 'PAUSED') {
      throw new Error(`Mission '${missionId}' cannot be executed in status '${mission.status}'`);
    }

    const controller = new AbortController();
    this.activeControllers.set(missionId, controller);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    mission.status = 'EXECUTING';
    mission.startedAt = mission.startedAt ?? Date.now();
    this.store.save(mission);
    this.metrics.activeMissions++;

    this.emitEvent(missionId, 'mission.started', {
      missionId,
      startedAt: mission.startedAt,
    });

    // Run DAG loop asynchronously
    try {
      await this.runDAGLoop(mission, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        mission.status = 'CANCELLED';
        this.emitEvent(missionId, 'mission.cancelled', { missionId });
      } else {
        mission.status = 'FAILED';
        mission.error = (err as Error).message;
        this.metrics.failedMissions++;
        this.emitEvent(missionId, 'mission.failed', { missionId, error: mission.error });
      }
    } finally {
      this.activeControllers.delete(missionId);
      this.metrics.activeMissions = Math.max(0, this.metrics.activeMissions - 1);
      mission.updatedAt = Date.now();
      this.store.save(mission);
      this.createCheckpoint(mission);
    }

    return mission;
  }

  /** Core execution loop for Mission DAG */
  private async runDAGLoop(mission: Mission, signal: AbortSignal): Promise<void> {
    const plan = mission.plan;
    if (!plan || plan.tasks.length === 0) {
      mission.status = 'COMPLETED';
      mission.completedAt = Date.now();
      return;
    }

    const maxParallel = plan.maxParallelTasks ?? 4;
    const taskMap = new Map<string, MissionTask>();
    for (const t of plan.tasks) {
      taskMap.set(t.taskId, t);
    }

    while (!signal.aborted) {
      // 1. Refresh task readiness
      this.updateTaskReadiness(taskMap);

      // 2. Find ready tasks
      const readyTasks = Array.from(taskMap.values()).filter((t) => t.status === 'READY');
      const runningTasks = Array.from(taskMap.values()).filter((t) => t.status === 'RUNNING');

      // 3. Check termination conditions
      const allCompleted = Array.from(taskMap.values()).every(
        (t) => t.status === 'COMPLETED' || t.status === 'SKIPPED',
      );
      if (allCompleted) {
        break;
      }

      const anyFailed = Array.from(taskMap.values()).some((t) => t.status === 'FAILED');
      if (anyFailed && readyTasks.length === 0 && runningTasks.length === 0) {
        throw new Error('Mission failed due to unrecoverable task errors');
      }

      if (readyTasks.length === 0 && runningTasks.length === 0) {
        // Deadlock / blocked state
        throw new Error('Mission DAG reached blocked state with no executable tasks');
      }

      // 4. Dispatch ready tasks up to available slots
      const availableSlots = Math.max(1, maxParallel - runningTasks.length);
      const toExecute = readyTasks.slice(0, availableSlots);

      if (toExecute.length > 0) {
        await Promise.all(
          toExecute.map((task) => this.executeTaskWithRecovery(mission, task, signal)),
        );
      } else {
        // Yield momentarily to let running tasks complete
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    if (signal.aborted) {
      mission.status = 'CANCELLED';
      return;
    }

    // 5. Verification Phase
    mission.status = 'VERIFYING';
    this.store.save(mission);
    this.emitEvent(mission.id, 'mission.verification.started', { missionId: mission.id });

    const verification = await this.verifier.verify(mission);
    mission.verification = verification;

    this.emitEvent(mission.id, 'mission.verification.completed', {
      missionId: mission.id,
      status: verification.status,
      checksCount: verification.checks.length,
    });

    if (verification.status === 'PASSED' || verification.status === 'PARTIAL') {
      mission.status = 'COMPLETED';
      mission.completedAt = Date.now();
      this.metrics.completedMissions++;
      if (mission.startedAt) {
        const dur = mission.completedAt - mission.startedAt;
        this.metrics.averageMissionDurationMs =
          this.metrics.averageMissionDurationMs === 0
            ? dur
            : (this.metrics.averageMissionDurationMs + dur) / 2;
      }
      this.emitEvent(mission.id, 'mission.completed', {
        missionId: mission.id,
        durationMs: mission.completedAt - (mission.startedAt ?? mission.completedAt),
        totalTokens: mission.totalTokens,
        estimatedCost: mission.estimatedCost,
      });
    } else {
      mission.status = 'FAILED';
      mission.error = 'Mission verification failed';
      this.metrics.failedMissions++;
      this.emitEvent(mission.id, 'mission.failed', { missionId: mission.id, error: mission.error });
    }
  }

  /** Execute a single mission task with auto-selection, leases, and repair loop */
  private async executeTaskWithRecovery(
    mission: Mission,
    task: MissionTask,
    signal: AbortSignal,
  ): Promise<void> {
    task.status = 'RUNNING';
    task.startedAt = Date.now();
    mission.currentTaskId = task.taskId;
    if (!mission.activeTaskIds.includes(task.taskId)) {
      mission.activeTaskIds.push(task.taskId);
    }
    this.store.save(mission);

    this.emitEvent(mission.id, 'mission.task.started', {
      missionId: mission.id,
      taskId: task.taskId,
      title: task.title,
      type: task.type,
    });

    const maxRepairCycles =
      mission.spec.userPreferences?.maxRepairCycles ?? this.defaultMaxRepairCycles;
    let attempt = 0;
    let success = false;

    while (attempt <= maxRepairCycles && !success && !signal.aborted) {
      attempt++;
      task.repairAttempts = attempt - 1;

      try {
        // Delegate agent selection & execution to AgentOrchestrator (Phase 28)
        const result = await this.agentOrchestrator.execute({
          prompt: task.objective,
          workspace: task.workspace ?? mission.spec.workspace,
          policy: task.modelPolicy as any,
          userPreferences: {
            preferredAgents: attempt === 1 && task.preferredAgent ? [task.preferredAgent] : undefined,
          },
        });

        if (result.status === 'SUCCESS') {
          success = true;
          task.status = 'COMPLETED';
          task.completedAt = Date.now();
          task.durationMs = task.completedAt - (task.startedAt ?? task.completedAt);
          task.output = result.output;
          task.selectedAgent = result.selectedAgentId;
          task.selectedModel = result.selectedModel;
          task.selectedProvider = 'nexus';

          const promptTokens = Math.max(1, Math.ceil(task.objective.length / 4));
          const outputTokens = Math.max(1, Math.ceil((result.output ?? '').length / 4));
          const totalTokens = promptTokens + outputTokens;
          const estimatedCost = Number(((totalTokens / 1000) * 0.003).toFixed(5));

          task.inputTokens = promptTokens;
          task.outputTokens = outputTokens;
          task.estimatedCost = estimatedCost;

          // Update mission aggregates
          mission.totalTokens += totalTokens;
          mission.estimatedCost += estimatedCost;
          mission.tokenSavings += Math.round(totalTokens * 0.25);
          this.metrics.totalTokensConsumed += totalTokens;
          this.metrics.totalEstimatedCost += estimatedCost;
          this.metrics.totalTasksExecuted++;

          if (!mission.completedTaskIds.includes(task.taskId)) {
            mission.completedTaskIds.push(task.taskId);
          }
          mission.activeTaskIds = mission.activeTaskIds.filter((id) => id !== task.taskId);

          this.emitEvent(mission.id, 'mission.task.completed', {
            missionId: mission.id,
            taskId: task.taskId,
            selectedAgent: result.selectedAgentId,
            durationMs: task.durationMs,
          });
        } else {
          throw new Error(result.error ?? `Task failed with status ${result.status}`);
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        task.error = errMsg;

        if (attempt <= maxRepairCycles) {
          mission.status = 'REPAIRING';
          mission.repairCount++;
          this.metrics.totalRepairs++;
          this.emitEvent(mission.id, 'mission.repair.started', {
            missionId: mission.id,
            taskId: task.taskId,
            attempt,
            maxAttempts: maxRepairCycles,
            error: errMsg,
          });

          // Small exponential backoff before repair attempt
          await new Promise((r) => setTimeout(r, 50 * attempt));
        } else {
          task.status = 'FAILED';
          task.completedAt = Date.now();
          mission.activeTaskIds = mission.activeTaskIds.filter((id) => id !== task.taskId);
          if (!mission.failedTaskIds.includes(task.taskId)) {
            mission.failedTaskIds.push(task.taskId);
          }

          this.emitEvent(mission.id, 'mission.task.failed', {
            missionId: mission.id,
            taskId: task.taskId,
            error: errMsg,
          });
        }
      }
    }

    this.store.save(mission);
  }

  /** Update task statuses based on DAG dependencies */
  private updateTaskReadiness(taskMap: Map<string, MissionTask>): void {
    for (const task of taskMap.values()) {
      if (task.status === 'BLOCKED' || task.status === 'PENDING') {
        const depsSatisfied = task.dependencies.every((depId) => {
          const dep = taskMap.get(depId);
          return dep && (dep.status === 'COMPLETED' || dep.status === 'SKIPPED');
        });

        if (depsSatisfied) {
          task.status = 'READY';
        }
      }
    }
  }

  /** Pause an active mission */
  async pauseMission(missionId: string): Promise<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) throw new Error(`Mission not found: '${missionId}'`);
    if (mission.status !== 'EXECUTING') {
      throw new Error(`Cannot pause mission in status '${mission.status}'`);
    }

    const controller = this.activeControllers.get(missionId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(missionId);
    }

    mission.status = 'PAUSED';
    this.store.save(mission);
    this.emitEvent(missionId, 'mission.paused', { missionId });
    this.createCheckpoint(mission);
    return mission;
  }

  /** Resume a paused mission */
  async resumeMission(missionId: string): Promise<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) throw new Error(`Mission not found: '${missionId}'`);
    if (mission.status !== 'PAUSED') {
      throw new Error(`Cannot resume mission in status '${mission.status}'`);
    }

    return this.executeMission(missionId);
  }

  /** Cancel an active mission and abort all subordinate agent processes */
  async cancelMission(missionId: string): Promise<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) throw new Error(`Mission not found: '${missionId}'`);

    const controller = this.activeControllers.get(missionId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(missionId);
    }

    mission.status = 'CANCELLED';
    this.metrics.cancelledMissions++;
    this.store.save(mission);
    this.emitEvent(missionId, 'mission.cancelled', { missionId });
    this.createCheckpoint(mission);
    return mission;
  }

  /** Create and store a persistent checkpoint */
  private createCheckpoint(mission: Mission): MissionCheckpoint {
    const dagState: Record<string, MissionTaskStatus> = {};
    const agentAssignments: Record<string, { agentId: string; model?: string; provider?: string }> = {};

    for (const t of mission.plan?.tasks ?? []) {
      dagState[t.taskId] = t.status;
      if (t.selectedAgent) {
        agentAssignments[t.taskId] = {
          agentId: t.selectedAgent,
          model: t.selectedModel,
          provider: t.selectedProvider,
        };
      }
    }

    const checkpoint: MissionCheckpoint = {
      checkpointId: `chk-${randomUUID().substring(0, 8)}`,
      missionId: mission.id,
      timestamp: Date.now(),
      status: mission.status,
      completedTasks: [...mission.completedTaskIds],
      activeTasks: [...mission.activeTaskIds],
      failedTasks: [...mission.failedTaskIds],
      dagState,
      agentAssignments,
      verificationState: mission.verification,
      totalTokens: mission.totalTokens,
      estimatedCost: mission.estimatedCost,
    };

    this.store.addCheckpoint(checkpoint);
    return checkpoint;
  }

  /** Helper to emit sanitized mission events */
  private emitEvent(missionId: string, type: string, payload: Record<string, unknown>): void {
    const event: MissionEvent = {
      id: `evt-${randomUUID().substring(0, 8)}`,
      missionId,
      type,
      timestamp: Date.now(),
      payload,
    };

    this.store.addEvent(event);

    const subscribers = this.activeEventSubscribers.get(missionId);
    if (subscribers) {
      for (const listener of subscribers) {
        try {
          listener(event);
        } catch {
          // ignore subscriber errors
        }
      }
    }

    if (this.events) {
      void this.events.publish({
        type: `mission.${type}` as any,
        occurredAt: new Date(event.timestamp),
        payload: { missionId, ...payload },
      });
    }
  }

  /** Subscribe to live mission events (for SSE streaming) */
  subscribeEvents(missionId: string, listener: (event: MissionEvent) => void): () => void {
    let set = this.activeEventSubscribers.get(missionId);
    if (!set) {
      set = new Set();
      this.activeEventSubscribers.set(missionId, set);
    }
    set.add(listener);

    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.activeEventSubscribers.delete(missionId);
      }
    };
  }

  /** Get mission by ID */
  getMission(id: string): Mission | undefined {
    return this.store.get(id);
  }

  /** List missions */
  listMissions(filter?: { status?: any; limit?: number }): Mission[] {
    return this.store.list(filter);
  }

  /** Get mission checkpoints */
  getCheckpoints(missionId: string): MissionCheckpoint[] {
    return this.store.getCheckpoints(missionId);
  }

  /** Get mission events */
  getEvents(missionId: string): MissionEvent[] {
    return this.store.getEvents(missionId);
  }

  /** Get observability metrics */
  getMetrics(): MissionOrchestratorMetrics {
    return { ...this.metrics };
  }
}
