/**
 * Agent Session domain (Phase 17 — Universal Agent Session Fabric).
 *
 * A persistent, observable, resumable session between the Nexus control plane
 * and a coding agent (Hermes / OpenCode / Claude Code / Codex / …).
 *
 * The status machine is EXPLICIT: illegal transitions are rejected so a
 * session can never silently enter a corrupt state.
 */

export type SessionStatus =
  | 'CREATED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_INPUT'
  | 'WAITING_APPROVAL'
  | 'PAUSED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export const SESSION_STATUSES: readonly SessionStatus[] = [
  'CREATED',
  'STARTING',
  'RUNNING',
  'WAITING_INPUT',
  'WAITING_APPROVAL',
  'PAUSED',
  'RECOVERING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];

/** Allowed next states for each current state. */
const TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  CREATED: ['STARTING', 'CANCELLED'],
  STARTING: ['RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'FAILED', 'CANCELLED'],
  RUNNING: ['WAITING_INPUT', 'WAITING_APPROVAL', 'PAUSED', 'RECOVERING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  WAITING_INPUT: ['RUNNING', 'PAUSED', 'CANCELLED', 'FAILED'],
  WAITING_APPROVAL: ['RUNNING', 'PAUSED', 'CANCELLED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCELLED', 'EXPIRED'],
  RECOVERING: ['RUNNING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  COMPLETED: ['EXPIRED'],
  FAILED: ['RECOVERING', 'CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

export interface AgentSession {
  readonly id: string;
  projectId?: string;
  workspaceId?: string;
  readonly agentId: string;
  readonly agentRuntime: string;
  modelId?: string;
  providerId?: string;
  status: SessionStatus;
  readonly createdAt: number;
  startedAt?: number;
  lastActivityAt?: number;
  completedAt?: number;
  prompt?: string;
  systemContext?: string;
  currentTaskId?: string;
  currentWorkflowId?: string;
  tokenUsage?: { input: number; output: number; cached: number; saved: number };
  costUsage?: { provider: number; model: number };
  checkpoint?: SessionCheckpoint;
  error?: string;
  failoverCount?: number;
  currentProvider?: string;
  currentModel?: string;
  lastFailoverReason?: string;
  approval?: { approvedBy?: string; approvalReason?: string; approvedAt?: number; required: boolean };
  readonly metadata?: Record<string, unknown>;
}

export interface SessionCheckpoint {
  readonly id: string;
  readonly createdAt: number;
  readonly status: SessionStatus;
  readonly agentId: string;
  readonly modelId?: string;
  readonly providerId?: string;
  readonly taskId?: string;
  readonly workflowId?: string;
  readonly conversationSummary?: string;
  readonly pendingActions?: string[];
  readonly approvalState?: { required: boolean };
}

/** Returns true if `from -> to` is a legal transition. */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throws on illegal transition. Use in state mutators. */
export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal session transition: ${from} -> ${to}`);
  }
}
