import { randomUUID } from 'node:crypto';

import {
  assertTransition,
  type AgentSession,
  type SessionCheckpoint,
  type SessionStatus,
} from '../domain/session.js';

import type { EventBusPort } from './ports.js';
import {
  SubprocessSessionRuntime,
  type AgentSessionRuntime,
} from './session-runtime.js';
import type { SessionStorePort } from './session-store.js';

export interface CreateSessionInput {
  agentId: string;
  agentRuntime?: string;
  modelId?: string;
  providerId?: string;
  projectId?: string;
  workspaceId?: string;
  prompt?: string;
  systemContext?: string;
  /** Command used to spawn the agent. If omitted, the manager emits a
   *  `session.start.failed` event (no subprocess) so the session remains
   *  observable without a real agent binary. */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Session manager (Phase 17 §2/§4/§6/§11). Owns the lifecycle of persistent
 * agent sessions. Reuses the EventBus for observability and the session
 * store for persistence. Model/provider/key failover is delegated to the
 * agent by pointing it at the Nexus gateway URL; the manager records
 * failover diagnostics when the runtime reports them.
 */
export class SessionManager {
  private readonly runtimes = new Map<string, AgentSessionRuntime>();

  constructor(
    private readonly store: SessionStorePort,
    private readonly bus: EventBusPort,
  ) {}

  async create(input: CreateSessionInput): Promise<AgentSession> {
    const now = Date.now();
    const session: AgentSession = {
      id: randomUUID(),
      agentId: input.agentId,
      agentRuntime: input.agentRuntime ?? 'subprocess',
      modelId: input.modelId,
      providerId: input.providerId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      prompt: input.prompt,
      systemContext: input.systemContext,
      status: 'CREATED',
      createdAt: now,
      metadata: {},
    };
    await this.store.save(session);
    this.bus.publish({
      type: 'session.created',
      occurredAt: new Date(now),
      correlationId: session.id,
      payload: { sessionId: session.id, agentId: session.agentId },
    });
    return session;
  }

  async start(sessionId: string, input?: Pick<CreateSessionInput, 'command' | 'args' | 'cwd' | 'env'>): Promise<AgentSession> {
    const session = await this.require(sessionId);
    this.applyStatus(session, 'STARTING');
    const cfg = input ?? {};
    if (cfg.command) {
      const runtime = new SubprocessSessionRuntime({
        command: cfg.command,
        args: cfg.args ?? [],
        cwd: cfg.cwd,
        env: cfg.env,
        onLine: (stream, line) => {
          this.bus.publish({
            type: 'session.message.received',
            occurredAt: new Date(),
            correlationId: sessionId,
            payload: { sessionId, stream, line },
          });
        },
        onExit: (code) => {
          void this.handleExit(sessionId, code);
        },
      });
      this.runtimes.set(sessionId, runtime);
      await runtime.start();
      this.applyStatus(session, 'RUNNING');
      this.bus.publish({
        type: 'session.started',
        occurredAt: new Date(),
        correlationId: sessionId,
        payload: { sessionId, agentId: session.agentId },
      });
    } else {
      // No agent binary configured — keep session observable, mark it created
      // and surface a diagnostic event instead of spawning nothing silently.
      this.applyStatus(session, 'CREATED');
      this.bus.publish({
        type: 'session.start.failed',
        occurredAt: new Date(),
        correlationId: sessionId,
        payload: { sessionId, reason: 'no agent command configured' },
      });
    }
    return session;
  }

  async send(sessionId: string, text: string): Promise<void> {
    const runtime = this.requireRuntime(sessionId);
    this.bus.publish({
      type: 'session.message.sent',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId, text },
    });
    await runtime.send(text);
    const session = await this.require(sessionId);
    session.lastActivityAt = Date.now();
    await this.store.save(session);
  }

  async pause(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    this.applyStatus(session, 'PAUSED');
    await this.runtimes.get(sessionId)?.pause();
    this.bus.publish({
      type: 'session.paused',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId },
    });
    return session;
  }

  async resume(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    this.applyStatus(session, 'RUNNING');
    await this.runtimes.get(sessionId)?.resume();
    this.bus.publish({
      type: 'session.resumed',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId },
    });
    return session;
  }

  async cancel(sessionId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    this.applyStatus(session, 'CANCELLED');
    await this.runtimes.get(sessionId)?.cancel();
    this.runtimes.delete(sessionId);
    this.bus.publish({
      type: 'session.cancelled',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId },
    });
    return session;
  }

  async restart(sessionId: string): Promise<AgentSession> {
    this.runtimes.get(sessionId)?.terminate();
    this.runtimes.delete(sessionId);
    return this.start(sessionId);
  }

  async checkpoint(sessionId: string, summary?: string): Promise<SessionCheckpoint> {
    const session = await this.require(sessionId);
    const cp: SessionCheckpoint = {
      id: randomUUID(),
      createdAt: Date.now(),
      status: session.status,
      agentId: session.agentId,
      modelId: session.modelId,
      providerId: session.providerId,
      taskId: session.currentTaskId,
      workflowId: session.currentWorkflowId,
      conversationSummary: summary,
      approvalState: session.approval ? { required: session.approval.required } : undefined,
    };
    session.checkpoint = cp;
    await this.store.save(session);
    this.bus.publish({
      type: 'session.checkpoint.created',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId, checkpointId: cp.id },
    });
    return cp;
  }

  async restore(sessionId: string, checkpointId: string): Promise<AgentSession> {
    const session = await this.require(sessionId);
    if (session.checkpoint?.id !== checkpointId) {
      throw new Error(`checkpoint ${checkpointId} not found for session ${sessionId}`);
    }
    this.applyStatus(session, 'RECOVERING');
    this.bus.publish({
      type: 'session.recovered',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId, checkpointId },
    });
    return session;
  }

  recordFailover(sessionId: string, reason: string, toProvider?: string, toModel?: string): void {
    void (async () => {
      const session = await this.require(sessionId);
      session.failoverCount = (session.failoverCount ?? 0) + 1;
      session.lastFailoverReason = reason;
      if (toProvider) session.currentProvider = toProvider;
      if (toModel) session.currentModel = toModel;
      await this.store.save(session);
      this.bus.publish({
        type: 'session.model.failover',
        occurredAt: new Date(),
        correlationId: sessionId,
        payload: { sessionId, reason, toProvider, toModel },
      });
    })();
  }

  async get(sessionId: string): Promise<AgentSession | undefined> {
    return this.store.get(sessionId);
  }

  async list(filter?: { status?: string; agentId?: string }): Promise<readonly AgentSession[]> {
    return this.store.list(filter);
  }

  private async handleExit(sessionId: string, code: number | null): Promise<void> {
    const session = await this.store.get(sessionId);
    if (!session) return;
    if (session.status === 'CANCELLED') return;
    session.status = code === 0 ? 'COMPLETED' : 'FAILED';
    session.completedAt = Date.now();
    session.error = code === 0 ? undefined : `agent exited with code ${code}`;
    await this.store.save(session);
    this.bus.publish({
      type: code === 0 ? 'session.completed' : 'session.failed',
      occurredAt: new Date(),
      correlationId: sessionId,
      payload: { sessionId, code },
    });
  }

  private async require(sessionId: string): Promise<AgentSession> {
    const s = await this.store.get(sessionId);
    if (!s) throw new Error(`session ${sessionId} not found`);
    return s;
  }

  private requireRuntime(sessionId: string): AgentSessionRuntime {
    const r = this.runtimes.get(sessionId);
    if (!r) throw new Error(`session ${sessionId} has no active runtime`);
    return r;
  }

  private applyStatus(session: AgentSession, to: SessionStatus): void {
    assertTransition(session.status, to);
    session.status = to;
    session.lastActivityAt = Date.now();
    if (to === 'RUNNING' && !session.startedAt) session.startedAt = Date.now();
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED' || to === 'EXPIRED') {
      session.completedAt = Date.now();
    }
    void this.store.save(session);
  }
}
