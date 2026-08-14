export type WorkflowStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'READY'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'PAUSED'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type WorkflowNodeStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'RETRYING';

export type NodeType =
  | 'TASK'
  | 'AGENT'
  | 'MODEL'
  | 'SHELL'
  | 'HTTP'
  | 'CONDITION'
  | 'PARALLEL'
  | 'APPROVAL'
  | 'WAIT'
  | 'ARTIFACT'
  | 'SUBWORKFLOW';

export interface WorkflowNode {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly config: Record<string, unknown>;
  status: WorkflowNodeStatus;
  output?: unknown;
  error?: string;
  attempts?: number;
}

export interface WorkflowEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly condition?: string;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly variables?: Record<string, unknown>;
}

export interface WorkflowApproval {
  readonly nodeId: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED';
  readonly reason?: string;
  readonly requestedBy?: string;
  readonly requestedAt?: number;
  readonly decidedAt?: number;
  readonly expiresAt?: number;
}

export interface WorkflowRun {
  readonly runId: string;
  readonly workflowId: string;
  status: WorkflowStatus;
  readonly createdAt: number;
  updatedAt: number;
  nodeStates: Record<string, WorkflowNodeStatus>;
  nodeAttempts: Record<string, number>;
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;
  approvals?: Record<string, WorkflowApproval>;
  error?: string;
}

export interface WorkflowCheckpoint {
  readonly runId: string;
  readonly workflowId: string;
  readonly timestamp: number;
  readonly completedNodeIds: readonly string[];
  readonly nodeStates: Record<string, WorkflowNodeStatus>;
  readonly nodeAttempts: Record<string, number>;
  readonly variables: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
  readonly approvals?: Record<string, WorkflowApproval>;
}
