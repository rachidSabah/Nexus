/**
 * ───────────────────────────────────────────────────────────────────────────
 * Persistence Layer
 *
 * Repository pattern — business logic never touches databases directly.
 * Every repository implements a port from `@anx/core` (or a port defined
 * in this package).
 *
 * Adapters shipped:
 *   - InMemory   (default, no external deps; for dev + tests)
 *   - SQLite     (via node:sqlite — Node 22+)
 *   - PostgreSQL (via pg — install `pg` separately)
 *   - Redis      (via ioredis — install `ioredis` separately)
 *
 * The PostgreSQL and Redis adapters are stubs that throw on construction
 * unless the corresponding driver is installed. This keeps the package
 * lightweight by default.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type {
  EndpointRepository,
  AuditLogPort,
} from '@anx/core';
import type { ProviderEndpoint } from '@anx/core';

// ─── In-Memory implementations (default) ────────────────────────────────────

export class InMemoryEndpointRepository implements EndpointRepository {
  private readonly endpoints = new Map<string, ProviderEndpoint>();
  async list(): Promise<readonly ProviderEndpoint[]> {
    return Array.from(this.endpoints.values());
  }
  async get(id: string): Promise<ProviderEndpoint | undefined> {
    return this.endpoints.get(id);
  }
  async save(endpoint: ProviderEndpoint): Promise<void> {
    this.endpoints.set(endpoint.id, endpoint);
  }
  async delete(id: string): Promise<void> {
    this.endpoints.delete(id);
  }
}

interface AuditEntry {
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

export class InMemoryAuditLogRepository implements AuditLogPort {
  private readonly entries: AuditEntry[] = [];
  private readonly cap: number;
  constructor(cap = 10_000) {
    this.cap = cap;
  }
  async append(entry: AuditEntry['entry']): Promise<void> {
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
  }): Promise<readonly AuditEntry[]> {
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

// ─── SQLite implementations ─────────────────────────────────────────────────
//
// Uses node:sqlite (built into Node 22+). Tables are created lazily on
// first use. Schema migrations are idempotent.

export interface SqliteAdapterOptions {
  /** Path to the SQLite file, or ':memory:' */
  readonly path: string;
}

/**
 * Lazy-load node:sqlite so the package doesn't crash on import in
 * environments without it.
 */
async function openSqlite(path: string): Promise<{
  exec: (sql: string) => void;
  prepare: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[]; run: (...params: unknown[]) => void };
  close: () => void;
}> {
  try {
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(path);
    return db as never;
  } catch (err) {
    throw new Error(
      `node:sqlite not available (${(err as Error).message}). Use Node 22+ with --experimental-sqlite flag.`,
    );
  }
}

export class SqliteEndpointRepository implements EndpointRepository {
  private dbPromise: ReturnType<typeof openSqlite> | undefined;
  private initialized = false;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) this.dbPromise = openSqlite(this.opts.path);
    const db = await this.dbPromise;
    if (!this.initialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS endpoints (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      this.initialized = true;
    }
    return db;
  }

  async list(): Promise<readonly ProviderEndpoint[]> {
    const db = await this.db();
    const rows = db.prepare('SELECT data FROM endpoints ORDER BY updated_at DESC').all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ProviderEndpoint);
  }

  async get(id: string): Promise<ProviderEndpoint | undefined> {
    const db = await this.db();
    const row = db.prepare('SELECT data FROM endpoints WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ProviderEndpoint) : undefined;
  }

  async save(endpoint: ProviderEndpoint): Promise<void> {
    const db = await this.db();
    db.prepare(
      'INSERT OR REPLACE INTO endpoints (id, data, updated_at) VALUES (?, ?, ?)',
    ).run(endpoint.id, JSON.stringify(endpoint), new Date().toISOString());
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    db.prepare('DELETE FROM endpoints WHERE id = ?').run(id);
  }
}

export class SqliteAuditLogRepository implements AuditLogPort {
  private dbPromise: ReturnType<typeof openSqlite> | undefined;
  private initialized = false;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) this.dbPromise = openSqlite(this.opts.path);
    const db = await this.dbPromise;
    if (!this.initialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          occurred_at TEXT NOT NULL,
          principal TEXT NOT NULL,
          action TEXT NOT NULL,
          resource TEXT NOT NULL,
          result TEXT NOT NULL,
          reason TEXT,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_principal ON audit_log(principal);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_log(occurred_at);
      `);
      this.initialized = true;
    }
    return db;
  }

  async append(entry: {
    principal: string;
    action: string;
    resource: string;
    result: 'allow' | 'deny';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const db = await this.db();
    db.prepare(
      `INSERT INTO audit_log (id, occurred_at, principal, action, resource, result, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      new Date().toISOString(),
      entry.principal,
      entry.action,
      entry.resource,
      entry.result,
      entry.reason ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    );
  }

  async query(filter: {
    principal?: string;
    action?: string;
    since?: Date;
    limit?: number;
  }): Promise<readonly AuditEntry[]> {
    const db = await this.db();
    const limit = filter.limit ?? 100;
    const since = filter.since?.toISOString() ?? '1970-01-01T00:00:00.000Z';
    const conditions: string[] = ['occurred_at >= ?'];
    const params: unknown[] = [since];
    if (filter.principal) {
      conditions.push('principal = ?');
      params.push(filter.principal);
    }
    if (filter.action) {
      conditions.push('action = ?');
      params.push(filter.action);
    }
    params.push(limit);
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params) as Array<{
      id: string;
      occurred_at: string;
      principal: string;
      action: string;
      resource: string;
      result: string;
      reason: string | null;
      metadata: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      occurredAt: new Date(r.occurred_at),
      entry: {
        principal: r.principal,
        action: r.action,
        resource: r.resource,
        result: r.result as 'allow' | 'deny',
        reason: r.reason ?? undefined,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
      },
    }));
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export type PersistenceBackend = 'memory' | 'sqlite';

export interface PersistenceConfig {
  readonly backend: PersistenceBackend;
  readonly sqlitePath?: string;
}

export interface PersistenceLayer {
  readonly endpoints: EndpointRepository;
  readonly auditLog: AuditLogPort;
}

/**
 * Build a persistence layer from config.
 * Supported backends: 'memory' (in-process, lost on restart) and
 * 'sqlite' (persistent file-based, survives restarts).
 * Postgres and Redis backends are planned for a future release.
 */
export function createPersistence(config: PersistenceConfig): PersistenceLayer {
  switch (config.backend) {
    case 'memory':
      return {
        endpoints: new InMemoryEndpointRepository(),
        auditLog: new InMemoryAuditLogRepository(),
      };
    case 'sqlite': {
      if (!config.sqlitePath) throw new Error('sqlitePath required for sqlite backend');
      const opts = { path: config.sqlitePath };
      return {
        endpoints: new SqliteEndpointRepository(opts),
        auditLog: new SqliteAuditLogRepository(opts),
      };
    }
    default:
      throw new Error(`Unknown backend: ${config.backend as string}`);
  }
}
