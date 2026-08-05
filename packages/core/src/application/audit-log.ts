import { randomUUID } from 'node:crypto';

import type { AuditLogPort } from './ports.js';

interface AuditLogEntry {
  id: string;
  occurredAt: Date;
  entry: {
    principal: string;
    action: string;
    resource: string;
    result: 'allow' | 'deny';
    reason?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * In-memory audit log. For production, swap with a Postgres or Elasticsearch
 * backed implementation. Entries are capped to prevent unbounded growth.
 */
export class InMemoryAuditLog implements AuditLogPort {
  private readonly entries: AuditLogEntry[] = [];
  private readonly cap: number;

  constructor(cap = 10_000) {
    this.cap = cap;
  }

  async append(entry: AuditLogEntry['entry']): Promise<void> {
    this.entries.push({ id: randomUUID(), occurredAt: new Date(), entry });
    if (this.entries.length > this.cap) {
      this.entries.splice(0, this.entries.length - this.cap);
    }
  }

  async query(filter: {
    principal?: string;
    action?: string;
    since?: Date;
    limit?: number;
  }): Promise<readonly AuditLogEntry[]> {
    const limit = filter.limit ?? 100;
    const since = filter.since?.getTime() ?? 0;
    return this.entries
      .filter(
        (e) =>
          (!filter.principal || e.entry.principal === filter.principal) &&
          (!filter.action || e.entry.action === filter.action) &&
          e.occurredAt.getTime() >= since,
      )
      .slice(-limit);
  }
}
