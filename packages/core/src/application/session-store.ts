import type { AgentSession } from '../domain/session.js';

/**
 * Session persistence port (Phase 17 §3). Reuses the TaskStore pattern.
 * In-memory by default; a file/DB adapter can implement the same port for
 * gateway-restart survival.
 */
export interface SessionStorePort {
  save(session: AgentSession): Promise<void>;
  get(sessionId: string): Promise<AgentSession | undefined>;
  list(filter?: { status?: string; agentId?: string }): Promise<readonly AgentSession[]>;
  delete(sessionId: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStorePort {
  private readonly sessions = new Map<string, AgentSession>();

  async save(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  async get(sessionId: string): Promise<AgentSession | undefined> {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : undefined;
  }

  async list(filter?: { status?: string; agentId?: string }): Promise<readonly AgentSession[]> {
    let result = Array.from(this.sessions.values());
    if (filter?.status) result = result.filter((s) => s.status === filter.status);
    if (filter?.agentId) result = result.filter((s) => s.agentId === filter.agentId);
    return result.map((s) => ({ ...s }));
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
