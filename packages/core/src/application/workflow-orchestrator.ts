import {
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowCheckpoint,
  type WorkflowNodeStatus,
} from '../domain/workflow.js';

import { DAGEngine } from './dag-engine.js';
import { TaskOrchestrator } from './task-orchestrator.js';

export class WorkflowOrchestrator {
  private readonly dagEngine = new DAGEngine();
  private readonly definitions = new Map<string, WorkflowDefinition>();
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly checkpoints = new Map<string, WorkflowCheckpoint>();

  constructor(private readonly taskOrchestrator: TaskOrchestrator) {}

  registerDefinition(def: WorkflowDefinition): { valid: boolean; errors: readonly string[] } {
    const val = this.dagEngine.validate(def);
    if (val.valid) {
      this.definitions.set(def.id, def);
    }
    return { valid: val.valid, errors: val.errors };
  }

  getDefinition(id: string): WorkflowDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(): readonly WorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }

  createRun(workflowId: string, initialVariables: Record<string, unknown> = {}): WorkflowRun {
    const def = this.definitions.get(workflowId);
    if (!def) throw new Error(`Workflow definition '${workflowId}' not found`);

    const runId = `wf-run-${Date.now()}`;
    const initialNodeStates: Record<string, WorkflowNodeStatus> = {};
    const initialNodeAttempts: Record<string, number> = {};
    for (const node of def.nodes) {
      initialNodeStates[node.id] = 'PENDING';
      initialNodeAttempts[node.id] = 0;
    }

    const run: WorkflowRun = {
      runId,
      workflowId,
      status: 'READY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodeStates: initialNodeStates,
      nodeAttempts: initialNodeAttempts,
      variables: { ...initialVariables },
      outputs: {},
      approvals: {},
    };

    this.runs.set(runId, run);
    this.saveCheckpoint(run);
    return run;
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(): readonly WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  async executeStep(runId: string, availableAgents: readonly any[]): Promise<WorkflowRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    if (run.status === 'PAUSED' || run.status === 'CANCELLED' || run.status === 'FAILED') {
      return run;
    }

    const def = this.definitions.get(run.workflowId);
    if (!def) throw new Error(`Workflow definition '${run.workflowId}' not found`);

    run.status = 'RUNNING';
    run.updatedAt = Date.now();

    const completedSet = new Set<string>();
    for (const [id, state] of Object.entries(run.nodeStates)) {
      if (state === 'COMPLETED') completedSet.add(id);
    }

    const readyNodes = this.dagEngine.getReadyNodes(def, completedSet);

    for (const nodeId of readyNodes) {
      const node = def.nodes.find(n => n.id === nodeId);
      if (!node) continue;

      if (node.type === 'APPROVAL' && run.nodeStates[nodeId] !== 'COMPLETED') {
        run.nodeStates[nodeId] = 'WAITING_APPROVAL';
        run.status = 'WAITING_APPROVAL';
        run.approvals = run.approvals ?? {};
        run.approvals[nodeId] = {
          nodeId,
          status: 'PENDING',
          requestedAt: Date.now(),
        };
        break;
      }

      run.nodeStates[nodeId] = 'RUNNING';
      run.nodeAttempts[nodeId] = (run.nodeAttempts[nodeId] ?? 0) + 1;
      const prompt = (node.config['prompt'] as string) ?? `Execute step ${node.name}`;
      const task = await this.taskOrchestrator.createTask(
        { prompt, dryRun: false },
        availableAgents
      );

      run.outputs[nodeId] = { taskId: task.taskId, status: task.status, selectedAgent: task.selectedAgent };
      run.nodeStates[nodeId] = 'COMPLETED';
      completedSet.add(nodeId);
    }

    if (completedSet.size === def.nodes.length) {
      run.status = 'COMPLETED';
    }

    this.saveCheckpoint(run);
    return run;
  }

  pauseRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);
    if (run.status === 'RUNNING' || run.status === 'READY') {
      run.status = 'PAUSED';
      run.updatedAt = Date.now();
      this.saveCheckpoint(run);
    }
    return run;
  }

  resumeRun(runId: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);
    if (run.status === 'PAUSED') {
      run.status = 'READY';
      run.updatedAt = Date.now();
      this.saveCheckpoint(run);
    }
    return run;
  }

  async cancelRun(runId: string): Promise<WorkflowRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    run.status = 'CANCELLED';
    run.updatedAt = Date.now();

    for (const [nodeId, output] of Object.entries(run.outputs)) {
      const o = output as { taskId?: string };
      if (o.taskId) {
        try {
          await this.taskOrchestrator.cancelTask(o.taskId);
        } catch {
          // ignore already completed or cancelled tasks
        }
      }
      if (run.nodeStates[nodeId] === 'RUNNING' || run.nodeStates[nodeId] === 'PENDING') {
        run.nodeStates[nodeId] = 'CANCELLED';
      }
    }

    this.saveCheckpoint(run);
    return run;
  }

  approveRun(runId: string, nodeId: string, reason?: string, decidedBy?: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    if (run.nodeStates[nodeId] === 'WAITING_APPROVAL') {
      run.nodeStates[nodeId] = 'COMPLETED';
      run.status = 'RUNNING';
      run.updatedAt = Date.now();
      run.approvals = run.approvals ?? {};
      run.approvals[nodeId] = {
        nodeId,
        status: 'APPROVED',
        reason,
        requestedBy: decidedBy,
        decidedAt: Date.now(),
      };
      this.saveCheckpoint(run);
    }
    return run;
  }

  rejectRun(runId: string, nodeId: string, reason?: string, decidedBy?: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run '${runId}' not found`);

    if (run.nodeStates[nodeId] === 'WAITING_APPROVAL') {
      run.nodeStates[nodeId] = 'FAILED';
      run.status = 'FAILED';
      run.updatedAt = Date.now();
      run.approvals = run.approvals ?? {};
      run.approvals[nodeId] = {
        nodeId,
        status: 'REJECTED',
        reason,
        requestedBy: decidedBy,
        decidedAt: Date.now(),
      };
      this.saveCheckpoint(run);
    }
    return run;
  }

  saveCheckpoint(run: WorkflowRun): WorkflowCheckpoint {
    const completedSet = new Set<string>();
    for (const [id, state] of Object.entries(run.nodeStates)) {
      if (state === 'COMPLETED') completedSet.add(id);
    }

    const checkpoint: WorkflowCheckpoint = {
      runId: run.runId,
      workflowId: run.workflowId,
      timestamp: Date.now(),
      completedNodeIds: Array.from(completedSet),
      nodeStates: { ...run.nodeStates },
      nodeAttempts: { ...run.nodeAttempts },
      variables: { ...run.variables },
      outputs: { ...run.outputs },
      approvals: run.approvals ? { ...run.approvals } : undefined,
    };
    this.checkpoints.set(run.runId, checkpoint);
    return checkpoint;
  }

  restoreCheckpoint(runId: string): WorkflowRun | undefined {
    const cp = this.checkpoints.get(runId);
    if (!cp) return undefined;

    const run = this.runs.get(runId);
    if (!run) return undefined;

    run.nodeStates = { ...cp.nodeStates };
    run.nodeAttempts = { ...cp.nodeAttempts };
    run.variables = { ...cp.variables };
    run.outputs = { ...cp.outputs };
    if (cp.approvals) run.approvals = { ...cp.approvals };
    run.updatedAt = Date.now();

    return run;
  }

  getCheckpoint(runId: string): WorkflowCheckpoint | undefined {
    return this.checkpoints.get(runId);
  }
}
