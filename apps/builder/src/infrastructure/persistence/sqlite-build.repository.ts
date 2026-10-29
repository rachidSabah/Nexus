import * as fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { BuildJob, BuildJobProps } from '../../domain/models/build-job.js';
import { Artifact, ArtifactProps } from '../../domain/models/artifact.js';
import {
  BuildQueryFilters,
  IBuildRepository,
} from '../../domain/ports/outbound/build-repository.port.js';

interface StoredBuildRecord {
  id: string;
  projectId: string;
  projectName?: string;
  commitHash?: string;
  branch?: string;
  status: any;
  steps: any[];
  environment?: Record<string, string>;
  workspacePath?: string;
  artifacts?: any[];
  logs?: string[];
  error?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  metrics?: any;
}

export class SqliteBuildRepository implements IBuildRepository {
  private readonly dbPath: string;
  private db: any = null;
  private cache: Map<string, BuildJob> = new Map();
  private loaded = false;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
  }

  private async ensureInit(): Promise<void> {
    if (this.loaded) return;
    const dir = path.dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      const sqlite = await import('node:sqlite');
      if ((sqlite as any)?.DatabaseSync) {
        this.db = new (sqlite as any).DatabaseSync(this.dbPath);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS build_jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            status TEXT NOT NULL,
            queued_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            data TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_build_project ON build_jobs(project_id);
          CREATE INDEX IF NOT EXISTS idx_build_status ON build_jobs(status);
        `);
      }
    } catch {
      this.db = null;
    }

    if (this.db) {
      try {
        const stmt = this.db.prepare('SELECT data FROM build_jobs');
        const rows = stmt.all() as Array<{ data: string }>;
        for (const r of rows) {
          const rec: StoredBuildRecord = JSON.parse(r.data);
          const job = this.deserializeJob(rec);
          this.cache.set(job.id, job);
        }
      } catch {
        // Fallback
      }
    } else {
      // JSON journal fallback
      const journalFile = this.dbPath.endsWith('.json') ? this.dbPath : `${this.dbPath}.json`;
      if (existsSync(journalFile)) {
        try {
          const data = readFileSync(journalFile, 'utf8');
          const parsed: StoredBuildRecord[] = JSON.parse(data);
          for (const rec of parsed) {
            const job = this.deserializeJob(rec);
            this.cache.set(job.id, job);
          }
        } catch {
          // Empty
        }
      }
    }

    this.loaded = true;
  }

  private deserializeJob(rec: StoredBuildRecord): BuildJob {
    const artifacts = (rec.artifacts || []).map(
      (a: ArtifactProps) =>
        new Artifact({
          ...a,
          createdAt: a.createdAt ? new Date(a.createdAt) : undefined,
        }),
    );

    const jobProps: BuildJobProps = {
      id: rec.id,
      projectId: rec.projectId,
      projectName: rec.projectName,
      commitHash: rec.commitHash,
      branch: rec.branch,
      status: rec.status,
      steps: rec.steps || [],
      environment: rec.environment,
      workspacePath: rec.workspacePath,
      artifacts,
      logs: rec.logs,
      error: rec.error,
      queuedAt: rec.queuedAt ? new Date(rec.queuedAt) : undefined,
      startedAt: rec.startedAt ? new Date(rec.startedAt) : undefined,
      completedAt: rec.completedAt ? new Date(rec.completedAt) : undefined,
      metrics: rec.metrics,
    };

    return new BuildJob(jobProps);
  }

  private serializeJob(job: BuildJob): StoredBuildRecord {
    return {
      id: job.id,
      projectId: job.projectId,
      projectName: job.projectName,
      commitHash: job.commitHash,
      branch: job.branch,
      status: job.status,
      steps: job.steps.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        cwd: s.cwd,
        env: s.env,
        continueOnError: s.continueOnError,
        timeoutMs: s.timeoutMs,
      })),
      environment: job.environment,
      workspacePath: job.workspacePath,
      artifacts: job.artifacts.map((a) => a.toJSON()),
      logs: job.logs,
      error: job.error,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      metrics: job.metrics,
    };
  }

  private async persistFallback(): Promise<void> {
    if (this.db) return;
    const journalFile = this.dbPath.endsWith('.json') ? this.dbPath : `${this.dbPath}.json`;
    const records = Array.from(this.cache.values()).map((job) => this.serializeJob(job));
    await fs.mkdir(path.dirname(journalFile), { recursive: true });
    await fs.writeFile(journalFile, JSON.stringify(records, null, 2), 'utf8');
  }

  public async save(job: BuildJob): Promise<void> {
    await this.ensureInit();
    this.cache.set(job.id, job);

    const record = this.serializeJob(job);
    const serialized = JSON.stringify(record);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO build_jobs (id, project_id, status, queued_at, started_at, completed_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            data = excluded.data
        `);
        stmt.run(
          job.id,
          job.projectId,
          job.status,
          record.queuedAt,
          record.startedAt ?? null,
          record.completedAt ?? null,
          serialized,
        );
      } catch {
        await this.persistFallback();
      }
    } else {
      await this.persistFallback();
    }
  }

  public async findById(id: string): Promise<BuildJob | null> {
    await this.ensureInit();
    return this.cache.get(id) || null;
  }

  public async findMany(filters?: BuildQueryFilters): Promise<BuildJob[]> {
    await this.ensureInit();
    let result = Array.from(this.cache.values());

    if (filters?.projectId) {
      result = result.filter((b) => b.projectId === filters.projectId);
    }
    if (filters?.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    result.sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime());

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;

    return result.slice(offset, offset + limit);
  }

  public async count(filters?: BuildQueryFilters): Promise<number> {
    await this.ensureInit();
    let result = Array.from(this.cache.values());

    if (filters?.projectId) {
      result = result.filter((b) => b.projectId === filters.projectId);
    }
    if (filters?.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    return result.length;
  }

  public async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    const existed = this.cache.delete(id);

    if (this.db) {
      try {
        const stmt = this.db.prepare('DELETE FROM build_jobs WHERE id = ?');
        stmt.run(id);
      } catch {
        await this.persistFallback();
      }
    } else {
      await this.persistFallback();
    }

    return existed;
  }

  public async findActiveBuilds(): Promise<BuildJob[]> {
    await this.ensureInit();
    return Array.from(this.cache.values()).filter(
      (b) => b.status === 'running' || b.status === 'queued',
    );
  }

  public clear(): void {
    this.cache.clear();
    if (this.db) {
      try {
        this.db.exec('DELETE FROM build_jobs');
      } catch {
        // ignore
      }
    }
  }
}
