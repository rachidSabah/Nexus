import { randomUUID } from 'node:crypto';

/**
 * Agent-to-Agent (A2A) Protocol.
 *
 * Lets the gateway orchestrate multiple specialized agents (e.g. one for
 * coding, one for retrieval, one for tool execution) and route messages
 * between them. Inspired by A2A proposals from Google, AWS, and others.
 *
 * Status: scaffold — the wire protocol is defined and the runtime can
 * route messages, but multi-agent orchestration primitives (planner,
 * executor, critic) are next-release.
 */

export type AgentRole = 'coordinator' | 'planner' | 'executor' | 'critic' | 'observer';

export interface AgentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly capabilities: readonly string[];
  readonly endpoint: string; // URL where this agent receives messages
  readonly publicKey?: string; // for signed messages
}

export interface A2AMessage {
  readonly id: string;
  readonly from: string; // agent ID
  readonly to: string | 'broadcast'; // agent ID or broadcast
  readonly type: 'request' | 'response' | 'event' | 'error';
  readonly taskId?: string;
  readonly replyTo?: string; // message ID
  readonly payload: unknown;
  readonly createdAt: string;
  readonly signature?: string;
}

/**
 * Registry of known agents. The coordinator uses this to route messages.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDescriptor>();

  register(agent: AgentDescriptor): void {
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId);
  }

  list(): readonly AgentDescriptor[] {
    return Array.from(this.agents.values());
  }

  findByCapability(capability: string): readonly AgentDescriptor[] {
    return this.list().filter((a) => a.capabilities.includes(capability));
  }
}

/**
 * A2A coordinator — routes messages between agents, tracks conversations,
 * and supports request/response correlation.
 *
 * For now, this is an in-process coordinator. A future release will support
 * remote agents over HTTP/gRPC.
 */
export class A2ACoordinator {
  private readonly handlers = new Map<string, (msg: A2AMessage) => Promise<unknown>>();
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Register a handler for messages addressed to a given agent.
   */
  onMessage(agentId: string, handler: (msg: A2AMessage) => Promise<unknown>): void {
    this.handlers.set(agentId, handler);
  }

  /**
   * Send a request to an agent and await its response.
   */
  async request(from: string, to: string, payload: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = randomUUID();
    const msg: A2AMessage = {
      id,
      from,
      to,
      type: 'request',
      payload,
      createdAt: new Date().toISOString(),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`A2A request ${id} timed out`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      void this.route(msg);
    });
  }

  /**
   * Send a one-way event to an agent (or broadcast).
   */
  async emit(from: string, to: string | 'broadcast', payload: unknown): Promise<void> {
    const msg: A2AMessage = {
      id: randomUUID(),
      from,
      to,
      type: 'event',
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.route(msg);
  }

  /**
   * Route a message to its destination(s) and handle the response.
   */
  private async route(msg: A2AMessage): Promise<void> {
    const targets = msg.to === 'broadcast' ? this.registry.list().map((a) => a.id) : [msg.to];

    for (const target of targets) {
      const handler = this.handlers.get(target);
      if (!handler) continue;
      try {
        const result = await handler(msg);
        if (msg.type === 'request' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          p.resolve(result);
        }
      } catch (err) {
        if (msg.type === 'request' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          p.reject(err as Error);
        }
      }
    }
  }
}
