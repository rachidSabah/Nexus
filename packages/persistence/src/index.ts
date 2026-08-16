/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/persistence — Phase 32 Durable Runtime, Persistence & Crash Recovery
 *
 * Repository pattern with multi-backend support:
 *   - SQLite (via node:sqlite / DatabaseSync on Node 22+)
 *   - Atomic JSON Journal Store (cross-platform, zero-dependency fallback)
 *   - InMemory (for test suites and ephemeral environments)
 *
 * Provides ACID durability, schema versioning, atomic file writes,
 * checkpointing, idempotency tracking, safe key metadata, and backup/restore.
 * Plaintext secrets are strictly excluded and stay in the encrypted vault.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import type {
  EndpointRepository,
  AuditLogPort,
  ProviderEndpoint,
  ModelDescriptor,
  Mission,
  MissionCheckpoint,
  MissionStatus,
  RuntimeIncident,
  IncidentRepositoryPort,
  IncidentStatus,
  SubsystemName,
} from '@anx/core';

// ─── Domain Models for Durable State ────────────────────────────────────────

export interface SchemaMigrationRecord {
  version: number;
  description: string;
  appliedAt: string;
}

export interface DurableKeyMetadata {
  keyId: string;
  providerId: string;
  status: 'active' | 'cooldown' | 'exhausted' | 'disabled' | 'error';
  cooldownUntil?: number;
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  lastUsedAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface DurableAgentExecution {
  executionId: string;
  agentId: string;
  missionId?: string;
  taskId?: string;
  pid?: number;
  workspace?: string;
  provider?: string;
  model?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABANDONED' | 'CANCELLED';
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  error?: string;
}

export interface DurableIdempotencyRecord {
  key: string;
  requestHash: string;
  status: 'PENDING' | 'COMPLETED';
  responseStatus?: number;
  responseBody?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuditEntry {
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

export interface BackupBundle {
  schemaVersion: number;
  nexusVersion: string;
  createdAt: string;
  checksum: string;
  data: {
    endpoints: ProviderEndpoint[];
    models: ModelDescriptor[];
    keyMetadata: DurableKeyMetadata[];
    missions: Mission[];
    checkpoints: MissionCheckpoint[];
    agentExecutions: DurableAgentExecution[];
    incidents?: RuntimeIncident[];
    auditLogs: Array<{
      id: string;
      occurredAt: string;
      principal: string;
      action: string;
      resource: string;
      result: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
}

// ─── Atomic File Storage Helper ─────────────────────────────────────────────

export class AtomicJsonStore<T> {
  constructor(private readonly filePath: string, private readonly defaultData: T) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  read(): T {
    if (!existsSync(this.filePath)) {
      return JSON.parse(JSON.stringify(this.defaultData)) as T;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return JSON.parse(JSON.stringify(this.defaultData)) as T;
    }
  }

  write(data: T): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    const serialized = JSON.stringify(data, null, 2);
    writeFileSync(tmp, serialized, 'utf8');
    renameSync(tmp, this.filePath);
  }
}

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

// ─── SQLite Adapters (Node 22+ node:sqlite or fallback) ─────────────────────

export interface SqliteAdapterOptions {
  /** Path to the SQLite file, or ':memory:' */
  readonly path: string;
}

export interface SqliteDB {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => void;
  };
  close?: () => void;
}

export async function openSqlite(path: string): Promise<SqliteDB> {
  try {
    const sqlite = await import('node:sqlite');
    if (path !== ':memory:') {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    const db = new (sqlite as any).DatabaseSync(path);
    return db as SqliteDB;
  } catch {
    // Return an in-memory SQL emulator fallback for environments without DatabaseSync
    return createSqliteEmulator(path);
  }
}

/** Lightweight in-memory/file emulator fallback when node:sqlite is not native */
function createSqliteEmulator(filePath: string): SqliteDB {
  const store = new Map<string, Map<string, any>>();
  const fileStore = filePath !== ':memory:' ? new AtomicJsonStore<Record<string, any[]>>(filePath + '.json', {}) : null;

  if (fileStore) {
    const loaded = fileStore.read();
    for (const [table, rows] of Object.entries(loaded)) {
      const rowMap = new Map<string, any>();
      for (const r of rows) {
        rowMap.set(r.id ?? r.key ?? randomUUID(), r);
      }
      store.set(table, rowMap);
    }
  }

  const persist = () => {
    if (!fileStore) return;
    const dumped: Record<string, any[]> = {};
    for (const [table, rows] of store.entries()) {
      dumped[table] = Array.from(rows.values());
    }
    fileStore.write(dumped);
  };

  return {
    exec: (sql: string) => {
      const tableMatches = sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/gi);
      for (const match of tableMatches) {
        const tbl = match[1];
        if (tbl && !store.has(tbl)) store.set(tbl, new Map());
      }
    },
    prepare: (sql: string) => {
      const normSql = sql.trim();
      return {
        get: (...params: unknown[]) => {
          if (normSql.includes('FROM schema_migrations')) {
            const list = Array.from(store.get('schema_migrations')?.values() ?? []);
            return list.sort((a, b) => b.version - a.version)[0];
          }
          if (normSql.includes('FROM endpoints WHERE id = ?')) {
            return store.get('endpoints')?.get(params[0] as string);
          }
          if (normSql.includes('FROM missions WHERE id = ?')) {
            return store.get('missions')?.get(params[0] as string);
          }
          if (normSql.includes('FROM idempotency_keys WHERE key = ?')) {
            const rec = store.get('idempotency_keys')?.get(params[0] as string);
            if (rec && rec.expires_at > Date.now()) return rec;
            return undefined;
          }
          if (normSql.includes('FROM runtime_incidents WHERE id = ?')) {
            const rec = store.get('runtime_incidents')?.get(params[0] as string);
            return rec ? { data: rec.data } : undefined;
          }
          return undefined;
        },
        all: (...params: unknown[]) => {
          if (normSql.includes('sqlite_master')) {
            return Array.from(store.keys()).map((name) => ({ name }));
          }
          if (normSql.includes('FROM endpoints')) {
            return Array.from(store.get('endpoints')?.values() ?? []);
          }
          if (normSql.includes('FROM missions')) {
            return Array.from(store.get('missions')?.values() ?? []);
          }
          if (normSql.includes('FROM mission_checkpoints WHERE mission_id = ?')) {
            const list = Array.from(store.get('mission_checkpoints')?.values() ?? []);
            return list.filter((r) => r.mission_id === params[0]).sort((a, b) => a.timestamp - b.timestamp);
          }
          if (normSql.includes('FROM models')) {
            return Array.from(store.get('models')?.values() ?? []);
          }
          if (normSql.includes('FROM audit_log')) {
            const list = Array.from(store.get('audit_log')?.values() ?? []);
            const limit = typeof params[params.length - 1] === 'number' ? (params[params.length - 1] as number) : 100;
            return list.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, limit);
          }
          if (normSql.includes('FROM agent_executions')) {
            return Array.from(store.get('agent_executions')?.values() ?? []);
          }
          if (normSql.includes('FROM api_keys_metadata')) {
            return Array.from(store.get('api_keys_metadata')?.values() ?? []);
          }
          if (normSql.includes('FROM runtime_incidents')) {
            let list = Array.from(store.get('runtime_incidents')?.values() ?? []);
            // Apply WHERE conditions from params
            let paramIdx = 0;
            const statusMatch = normSql.match(/status\s*=\s*\?/);
            const subsystemMatch = normSql.match(/subsystem\s*=\s*\?/);
            if (statusMatch) {
              const statusVal = params[paramIdx++] as string;
              list = list.filter((r: any) => r.status === statusVal);
            }
            if (subsystemMatch) {
              const subVal = params[paramIdx++] as string;
              list = list.filter((r: any) => r.subsystem === subVal);
            }
            list.sort((a: any, b: any) => b.created_at - a.created_at);
            const limitMatch = normSql.includes('LIMIT ?');
            if (limitMatch && params[paramIdx] !== undefined) {
              list = list.slice(0, params[paramIdx] as number);
            }
            return list.map((r: any) => ({ data: r.data }));
          }
          return [];
        },
        run: (...params: unknown[]) => {
          if (normSql.startsWith('INSERT INTO schema_migrations') || normSql.startsWith('INSERT OR REPLACE INTO schema_migrations')) {
            const tbl = store.get('schema_migrations') ?? new Map();
            tbl.set(String(params[0]), { version: params[0], description: params[1], applied_at: params[2] });
            store.set('schema_migrations', tbl);
          } else if (normSql.includes('INTO endpoints')) {
            const tbl = store.get('endpoints') ?? new Map();
            tbl.set(String(params[0]), { id: params[0], data: params[1], updated_at: params[2] });
            store.set('endpoints', tbl);
          } else if (normSql.includes('DELETE FROM endpoints WHERE id = ?')) {
            store.get('endpoints')?.delete(String(params[0]));
          } else if (normSql.includes('INTO missions')) {
            const tbl = store.get('missions') ?? new Map();
            tbl.set(String(params[0]), { id: params[0], status: params[1], data: params[2], updated_at: params[3] });
            store.set('missions', tbl);
          } else if (normSql.includes('DELETE FROM missions WHERE id = ?')) {
            store.get('missions')?.delete(String(params[0]));
          } else if (normSql.includes('INTO mission_checkpoints')) {
            const tbl = store.get('mission_checkpoints') ?? new Map();
            tbl.set(String(params[0]), { id: params[0], mission_id: params[1], timestamp: params[2], data: params[3] });
            store.set('mission_checkpoints', tbl);
          } else if (normSql.includes('DELETE FROM mission_checkpoints WHERE mission_id = ?')) {
            const tbl = store.get('mission_checkpoints');
            if (tbl) {
              for (const [k, v] of tbl.entries()) {
                if (v.mission_id === params[0]) tbl.delete(k);
              }
            }
          } else if (normSql.includes('INTO models')) {
            const tbl = store.get('models') ?? new Map();
            tbl.set(String(params[0]), { id: params[0], provider_id: params[1], data: params[2], updated_at: params[3] });
            store.set('models', tbl);
          } else if (normSql.startsWith('UPDATE idempotency_keys')) {
            const tbl = store.get('idempotency_keys');
            const key = String(params[3]);
            const rec = tbl?.get(key);
            if (rec) {
              rec.status = params[0];
              rec.response_status = params[1];
              rec.response_body = params[2];
            }
          } else if (normSql.includes('INTO idempotency_keys')) {
            const tbl = store.get('idempotency_keys') ?? new Map();
            if (normSql.includes('(key, request_hash, status, created_at, expires_at)')) {
              tbl.set(String(params[0]), {
                key: params[0],
                request_hash: params[1],
                status: params[2],
                created_at: params[3],
                expires_at: params[4],
              });
            } else {
              tbl.set(String(params[0]), {
                key: params[0],
                request_hash: params[1],
                status: params[2],
                response_status: params[3],
                response_body: params[4],
                created_at: params[5],
                expires_at: params[6],
              });
            }
            store.set('idempotency_keys', tbl);
          } else if (normSql.includes('INTO agent_executions')) {
            const tbl = store.get('agent_executions') ?? new Map();
            tbl.set(String(params[0]), {
              execution_id: params[0],
              agent_id: params[1],
              mission_id: params[2],
              task_id: params[3],
              pid: params[4],
              status: params[5],
              data: params[6],
              updated_at: params[7],
            });
            store.set('agent_executions', tbl);
          } else if (normSql.includes('INTO api_keys_metadata')) {
            const tbl = store.get('api_keys_metadata') ?? new Map();
            tbl.set(String(params[0]), {
              key_id: params[0],
              provider_id: params[1],
              status: params[2],
              data: params[3],
              updated_at: params[4],
            });
            store.set('api_keys_metadata', tbl);
          } else if (normSql.includes('INTO audit_log')) {
            const tbl = store.get('audit_log') ?? new Map();
            tbl.set(String(params[0]), {
              id: params[0],
              occurred_at: params[1],
              principal: params[2],
              action: params[3],
              resource: params[4],
              result: params[5],
              reason: params[6],
              metadata: params[7],
            });
            store.set('audit_log', tbl);
          } else if (normSql.includes('INTO runtime_incidents')) {
            const tbl = store.get('runtime_incidents') ?? new Map();
            tbl.set(String(params[0]), {
              id: params[0],
              subsystem: params[1],
              status: params[2],
              severity: params[3],
              anomaly_type: params[4],
              data: params[5],
              created_at: params[6],
              updated_at: params[7],
            });
            store.set('runtime_incidents', tbl);
          }
          persist();
        },
      };
    },
    close: () => {
      persist();
    },
  };
}

// ─── Schema Migrator ────────────────────────────────────────────────────────

export class SchemaMigrationManager {
  static readonly CURRENT_SCHEMA_VERSION = 3;

  static async applyMigrations(db: SqliteDB): Promise<number> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    let current = 0;
    try {
      const row = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
      if (row) current = row.version;
    } catch {
      current = 0;
    }

    if (current < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS endpoints (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
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
      db.prepare('INSERT OR REPLACE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')
        .run(1, 'Initial endpoints and audit log tables', new Date().toISOString());
      current = 1;
    }

    if (current < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);

        CREATE TABLE IF NOT EXISTS mission_checkpoints (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_mission ON mission_checkpoints(mission_id);

        CREATE TABLE IF NOT EXISTS models (
          id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (provider_id, id)
        );

        CREATE TABLE IF NOT EXISTS agent_executions (
          execution_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          mission_id TEXT,
          task_id TEXT,
          pid INTEGER,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys_metadata (
          key_id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key TEXT PRIMARY KEY,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          response_status INTEGER,
          response_body TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      db.prepare('INSERT OR REPLACE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')
        .run(2, 'Phase 32 Durable missions, checkpoints, agent leases, models, and idempotency', new Date().toISOString());
      current = 2;
    }

    if (current < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_incidents (
          id TEXT PRIMARY KEY,
          subsystem TEXT NOT NULL,
          status TEXT NOT NULL,
          severity TEXT NOT NULL,
          anomaly_type TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_incidents_status ON runtime_incidents(status);
        CREATE INDEX IF NOT EXISTS idx_incidents_subsystem ON runtime_incidents(subsystem);
        CREATE INDEX IF NOT EXISTS idx_incidents_created ON runtime_incidents(created_at);
      `);
      db.prepare('INSERT OR REPLACE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')
        .run(3, 'Phase 34 Runtime Intelligence incidents, anomalies, and remediation history', new Date().toISOString());
      current = 3;
    }

    return current;
  }
}

// ─── Durable Repositories ───────────────────────────────────────────────────

export class SqliteEndpointRepository implements EndpointRepository {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
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
    db.prepare('INSERT OR REPLACE INTO endpoints (id, data, updated_at) VALUES (?, ?, ?)').run(
      endpoint.id,
      JSON.stringify(endpoint),
      new Date().toISOString(),
    );
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    db.prepare('DELETE FROM endpoints WHERE id = ?').run(id);
  }
}

export class SqliteAuditLogRepository implements AuditLogPort {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
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

// ─── Durable Mission Store ──────────────────────────────────────────────────

export class DurableMissionStore {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  async save(mission: Mission): Promise<void> {
    const db = await this.db();
    const updated = mission.updatedAt ?? Date.now();
    db.prepare('INSERT OR REPLACE INTO missions (id, status, data, updated_at) VALUES (?, ?, ?, ?)').run(
      mission.id,
      mission.status,
      JSON.stringify(mission),
      updated,
    );
  }

  async get(id: string): Promise<Mission | undefined> {
    const db = await this.db();
    const row = db.prepare('SELECT data FROM missions WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Mission) : undefined;
  }

  async list(filter?: { status?: MissionStatus; limit?: number }): Promise<Mission[]> {
    const db = await this.db();
    const rows = db.prepare('SELECT data FROM missions ORDER BY updated_at DESC').all() as Array<{ data: string }>;
    let missions = rows.map((r) => JSON.parse(r.data) as Mission);
    if (filter?.status) {
      missions = missions.filter((m) => m.status === filter.status);
    }
    if (filter?.limit && filter.limit > 0) {
      missions = missions.slice(0, filter.limit);
    }
    return missions;
  }

  async delete(id: string): Promise<boolean> {
    const db = await this.db();
    db.prepare('DELETE FROM mission_checkpoints WHERE mission_id = ?').run(id);
    db.prepare('DELETE FROM missions WHERE id = ?').run(id);
    return true;
  }

  async addCheckpoint(checkpoint: MissionCheckpoint): Promise<void> {
    const db = await this.db();
    db.prepare('INSERT OR REPLACE INTO mission_checkpoints (id, mission_id, timestamp, data) VALUES (?, ?, ?, ?)').run(
      checkpoint.checkpointId,
      checkpoint.missionId,
      checkpoint.timestamp,
      JSON.stringify(checkpoint),
    );

    const m = await this.get(checkpoint.missionId);
    if (m) {
      const count = (await this.getCheckpoints(checkpoint.missionId)).length;
      m.checkpointsCount = count;
      await this.save(m);
    }
  }

  async saveCheckpoint(checkpoint: MissionCheckpoint): Promise<void> {
    return this.addCheckpoint(checkpoint);
  }

  async getCheckpoints(missionId: string): Promise<MissionCheckpoint[]> {
    const db = await this.db();
    const rows = db.prepare('SELECT data FROM mission_checkpoints WHERE mission_id = ? ORDER BY timestamp ASC').all(missionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as MissionCheckpoint);
  }

  async getLatestCheckpoint(missionId: string): Promise<MissionCheckpoint | undefined> {
    const list = await this.getCheckpoints(missionId);
    return list[list.length - 1];
  }
}

// ─── Durable Idempotency Store ──────────────────────────────────────────────

export class DurableIdempotencyStore {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  async reserve(key: string, requestPayload: unknown, ttlMs = 60_000): Promise<{ isNew: boolean; existingRecord?: DurableIdempotencyRecord }> {
    const db = await this.db();
    const hash = createHash('sha256').update(typeof requestPayload === 'string' ? requestPayload : JSON.stringify(requestPayload ?? '')).digest('hex');
    const existing = db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key) as any;

    if (existing) {
      if (existing.expires_at > Date.now()) {
        if (existing.request_hash !== hash) {
          throw new Error(`Idempotency conflict: request payload mismatch for key '${key}'`);
        }
        return {
          isNew: false,
          existingRecord: {
            key: existing.key,
            requestHash: existing.request_hash,
            status: existing.status,
            responseStatus: existing.response_status,
            responseBody: existing.response_body,
            createdAt: existing.created_at,
            expiresAt: existing.expires_at,
          },
        };
      }
    }

    const now = Date.now();
    const expiresAt = now + ttlMs;
    db.prepare('INSERT OR REPLACE INTO idempotency_keys (key, request_hash, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      key,
      hash,
      'PENDING',
      now,
      expiresAt,
    );

    return { isNew: true };
  }

  async complete(key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const db = await this.db();
    const bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    db.prepare('UPDATE idempotency_keys SET status = ?, response_status = ?, response_body = ? WHERE key = ?').run(
      'COMPLETED',
      responseStatus,
      bodyStr,
      key,
    );
  }
}

// ─── Durable Agent Execution Store ──────────────────────────────────────────

export class DurableAgentExecutionStore {
  private dbPromise: Promise<SqliteDB> | undefined;

  constructor(private readonly opts: SqliteAdapterOptions) {}

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  async recordExecution(exec: DurableAgentExecution): Promise<void> {
    const db = await this.db();
    db.prepare(
      'INSERT OR REPLACE INTO agent_executions (execution_id, agent_id, mission_id, task_id, pid, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      exec.executionId,
      exec.agentId,
      exec.missionId ?? null,
      exec.taskId ?? null,
      exec.pid ?? null,
      exec.status,
      JSON.stringify(exec),
      Date.now(),
    );
  }

  async listActive(): Promise<DurableAgentExecution[]> {
    const db = await this.db();
    const rows = db.prepare("SELECT data FROM agent_executions WHERE status = 'RUNNING'").all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as DurableAgentExecution);
  }

  async updateStatus(executionId: string, status: DurableAgentExecution['status'], error?: string): Promise<void> {
    const db = await this.db();
    const row = db.prepare('SELECT data FROM agent_executions WHERE execution_id = ?').get(executionId) as { data: string } | undefined;
    if (!row) return;
    const exec = JSON.parse(row.data) as DurableAgentExecution;
    exec.status = status;
    if (error) exec.error = error;
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'ABANDONED') {
      exec.completedAt = Date.now();
    }
    await this.recordExecution(exec);
  }
}

// ─── Durable Incident Store (Phase 34) ───────────────────────────────────────

export class DurableIncidentStore implements IncidentRepositoryPort {
  private dbPromise: Promise<SqliteDB> | undefined;
  private readonly fallbackStore?: AtomicJsonStore<Record<string, RuntimeIncident>>;

  constructor(private readonly opts?: SqliteAdapterOptions) {
    if (opts?.path) {
      const jsonPath = opts.path.replace(/\.db$/, '_incidents.json');
      this.fallbackStore = new AtomicJsonStore<Record<string, RuntimeIncident>>(jsonPath, {});
    }
  }

  private async db(): Promise<SqliteDB | undefined> {
    if (!this.opts?.path) return undefined;
    if (!this.dbPromise) {
      this.dbPromise = openSqlite(this.opts.path).then(async (db) => {
        await SchemaMigrationManager.applyMigrations(db);
        return db;
      });
    }
    return this.dbPromise;
  }

  async save(incident: RuntimeIncident): Promise<void> {
    const db = await this.db();
    if (db) {
      db.prepare(
        'INSERT OR REPLACE INTO runtime_incidents (id, subsystem, status, severity, anomaly_type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        incident.id,
        incident.subsystem,
        incident.status,
        incident.severity,
        incident.anomalyType,
        JSON.stringify(incident),
        incident.createdAt,
        Date.now(),
      );
    }
    if (this.fallbackStore) {
      const data = this.fallbackStore.read();
      data[incident.id] = incident;
      this.fallbackStore.write(data);
    }
  }

  async get(id: string): Promise<RuntimeIncident | undefined> {
    const db = await this.db();
    if (db) {
      const row = db.prepare('SELECT data FROM runtime_incidents WHERE id = ?').get(id) as { data: string } | undefined;
      if (row) return JSON.parse(row.data) as RuntimeIncident;
    }
    if (this.fallbackStore) {
      const data = this.fallbackStore.read();
      return data[id];
    }
    return undefined;
  }

  async list(options?: { status?: IncidentStatus; subsystem?: SubsystemName; limit?: number }): Promise<RuntimeIncident[]> {
    const db = await this.db();
    if (db) {
      let sql = 'SELECT data FROM runtime_incidents';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (options?.status) {
        conditions.push('status = ?');
        params.push(options.status);
      }
      if (options?.subsystem) {
        conditions.push('subsystem = ?');
        params.push(options.subsystem);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ' ORDER BY created_at DESC';

      if (options?.limit && options.limit > 0) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = db.prepare(sql).all(...params) as Array<{ data: string }>;
      return rows.map((r) => JSON.parse(r.data) as RuntimeIncident);
    }

    if (this.fallbackStore) {
      const data = this.fallbackStore.read();
      let list = Object.values(data);
      if (options?.status) list = list.filter((i) => i.status === options.status);
      if (options?.subsystem) list = list.filter((i) => i.subsystem === options.subsystem);
      list.sort((a, b) => b.createdAt - a.createdAt);
      if (options?.limit) list = list.slice(0, options.limit);
      return list;
    }

    return [];
  }
}

// ─── Backup & Restore Engine ────────────────────────────────────────────────

export class BackupRestoreEngine {
  constructor(private readonly dbPath: string) {}

  async createBackup(version = '0.5.0'): Promise<BackupBundle> {
    const db = await openSqlite(this.dbPath);
    await SchemaMigrationManager.applyMigrations(db);

    const endpoints = (db.prepare('SELECT data FROM endpoints').all() as any[]).map((r) => JSON.parse(r.data));
    const models = (db.prepare('SELECT data FROM models').all() as any[]).map((r) => JSON.parse(r.data));
    const keyMetadata = (db.prepare('SELECT data FROM api_keys_metadata').all() as any[]).map((r) => JSON.parse(r.data));
    const missions = (db.prepare('SELECT data FROM missions').all() as any[]).map((r) => JSON.parse(r.data));
    const checkpoints = (db.prepare('SELECT data FROM mission_checkpoints').all() as any[]).map((r) => JSON.parse(r.data));
    const agentExecutions = (db.prepare('SELECT data FROM agent_executions').all() as any[]).map((r) => JSON.parse(r.data));
    const incidents = (db.prepare('SELECT data FROM runtime_incidents').all() as any[]).map((r) => JSON.parse(r.data));
    const auditLogs = (db.prepare('SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 5000').all() as any[]).map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      principal: r.principal,
      action: r.action,
      resource: r.resource,
      result: r.result,
      reason: r.reason,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));

    const rawData = {
      endpoints,
      models,
      keyMetadata,
      missions,
      checkpoints,
      agentExecutions,
      incidents,
      auditLogs,
    };

    const serialized = JSON.stringify(rawData);
    const checksum = createHash('sha256').update(serialized).digest('hex');

    return {
      schemaVersion: SchemaMigrationManager.CURRENT_SCHEMA_VERSION,
      nexusVersion: version,
      createdAt: new Date().toISOString(),
      checksum,
      data: rawData,
    };
  }

  async restoreBackup(bundle: BackupBundle): Promise<{ restoredCounts: Record<string, number> }> {
    if (!bundle.data || !bundle.checksum) {
      throw new Error('Invalid backup format: missing data or checksum');
    }

    const computed = createHash('sha256').update(JSON.stringify(bundle.data)).digest('hex');
    if (computed !== bundle.checksum) {
      throw new Error('Backup integrity violation: checksum mismatch');
    }

    const db = await openSqlite(this.dbPath);
    await SchemaMigrationManager.applyMigrations(db);

    const counts: Record<string, number> = {
      endpoints: 0,
      models: 0,
      missions: 0,
      checkpoints: 0,
      incidents: 0,
    };

    for (const ep of bundle.data.endpoints ?? []) {
      db.prepare('INSERT OR REPLACE INTO endpoints (id, data, updated_at) VALUES (?, ?, ?)').run(
        ep.id,
        JSON.stringify(ep),
        new Date().toISOString(),
      );
      counts['endpoints'] = (counts['endpoints'] ?? 0) + 1;
    }

    for (const m of bundle.data.missions ?? []) {
      db.prepare('INSERT OR REPLACE INTO missions (id, status, data, updated_at) VALUES (?, ?, ?, ?)').run(
        m.id,
        m.status,
        JSON.stringify(m),
        m.updatedAt ?? Date.now(),
      );
      counts['missions'] = (counts['missions'] ?? 0) + 1;
    }

    for (const cp of bundle.data.checkpoints ?? []) {
      db.prepare('INSERT OR REPLACE INTO mission_checkpoints (id, mission_id, timestamp, data) VALUES (?, ?, ?, ?)').run(
        cp.checkpointId,
        cp.missionId,
        cp.timestamp,
        JSON.stringify(cp),
      );
      counts['checkpoints'] = (counts['checkpoints'] ?? 0) + 1;
    }

    for (const inc of bundle.data.incidents ?? []) {
      db.prepare('INSERT OR REPLACE INTO runtime_incidents (id, subsystem, status, severity, anomaly_type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        inc.id,
        inc.subsystem,
        inc.status,
        inc.severity,
        inc.anomalyType,
        JSON.stringify(inc),
        inc.createdAt,
        Date.now(),
      );
      counts['incidents'] = (counts['incidents'] ?? 0) + 1;
    }

    return { restoredCounts: counts };
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
  readonly missions?: DurableMissionStore;
  readonly idempotency?: DurableIdempotencyStore;
  readonly agentExecutions?: DurableAgentExecutionStore;
  readonly incidents?: DurableIncidentStore;
  readonly backupRestore?: BackupRestoreEngine;
}

export function createPersistence(config: PersistenceConfig): PersistenceLayer {
  switch (config.backend) {
    case 'memory':
      return {
        endpoints: new InMemoryEndpointRepository(),
        auditLog: new InMemoryAuditLogRepository(),
        incidents: new DurableIncidentStore(),
      };
    case 'sqlite': {
      if (!config.sqlitePath) throw new Error('sqlitePath required for sqlite backend');
      const opts = { path: config.sqlitePath };
      return {
        endpoints: new SqliteEndpointRepository(opts),
        auditLog: new SqliteAuditLogRepository(opts),
        missions: new DurableMissionStore(opts),
        idempotency: new DurableIdempotencyStore(opts),
        agentExecutions: new DurableAgentExecutionStore(opts),
        incidents: new DurableIncidentStore(opts),
        backupRestore: new BackupRestoreEngine(config.sqlitePath),
      };
    }
    default:
      throw new Error(`Unknown backend: ${config.backend as string}`);
  }
}
