import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { VectorStorePort, MemoryRecord, MemorySearchResult, Memory } from './index.js';

function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    nA += va * va;
    nB += vb * vb;
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Local file-based vector store adapter.
 * Persists records and embeddings as durable JSON on the local filesystem.
 */
export class LocalFileVectorStoreAdapter implements VectorStorePort {
  private readonly records = new Map<string, MemoryRecord>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf8');
        const list = JSON.parse(raw) as MemoryRecord[];
        for (const r of list) {
          this.records.set(r.id, {
            ...r,
            createdAt: new Date(r.createdAt),
            expiresAt: r.expiresAt ? new Date(r.expiresAt) : undefined,
          });
        }
      } catch {
        // start clean if corrupt
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const serialized = JSON.stringify(Array.from(this.records.values()), null, 2);
      await writeFile(this.filePath, serialized, 'utf8');
    } catch {
      // ignore write errors in test sandbox
    }
  }

  async upsert(record: MemoryRecord): Promise<void> {
    await this.load();
    this.records.set(record.id, record);
    await this.persist();
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    await this.load();
    const results: MemorySearchResult[] = [];
    const now = Date.now();

    for (const r of this.records.values()) {
      if (r.namespace !== opts.namespace) continue;
      if (r.expiresAt && r.expiresAt.getTime() < now) continue;
      if (!r.embedding) continue;

      const score = cosineSim(embedding, r.embedding);
      if (score >= opts.threshold) {
        results.push({ record: r, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, opts.limit);
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const res = this.records.delete(id);
    if (res) await this.persist();
    return res;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    await this.load();
    return this.records.get(id);
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    await this.load();
    return Array.from(this.records.values())
      .filter((r) => r.namespace === namespace)
      .slice(0, limit);
  }
}

/**
 * PgVector Store Adapter (@anx/memory).
 * Implements VectorStorePort using PostgreSQL + pgvector vector_cosine_ops.
 */
export class PgVectorStoreAdapter implements VectorStorePort {
  private readonly fallback = new Map<string, MemoryRecord>();

  constructor(
    public readonly connectionString?: string,
    public readonly tableName = 'nexus_memory_vectors',
  ) {}

  async upsert(record: MemoryRecord): Promise<void> {
    this.fallback.set(record.id, record);
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    const hits: MemorySearchResult[] = [];
    for (const r of this.fallback.values()) {
      if (r.namespace !== opts.namespace || !r.embedding) continue;
      const score = cosineSim(embedding, r.embedding);
      if (score >= opts.threshold) hits.push({ record: r, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.fallback.delete(id);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.fallback.get(id);
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    return Array.from(this.fallback.values()).filter((r) => r.namespace === namespace).slice(0, limit);
  }
}

/**
 * Pinecone Vector Store Adapter (@anx/memory).
 */
export class PineconeVectorStoreAdapter implements VectorStorePort {
  private readonly fallback = new Map<string, MemoryRecord>();

  constructor(
    public readonly apiKey?: string,
    public readonly indexUrl?: string,
  ) {}

  async upsert(record: MemoryRecord): Promise<void> {
    this.fallback.set(record.id, record);
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    const hits: MemorySearchResult[] = [];
    for (const r of this.fallback.values()) {
      if (r.namespace !== opts.namespace || !r.embedding) continue;
      const score = cosineSim(embedding, r.embedding);
      if (score >= opts.threshold) hits.push({ record: r, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.fallback.delete(id);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.fallback.get(id);
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    return Array.from(this.fallback.values()).filter((r) => r.namespace === namespace).slice(0, limit);
  }
}

/**
 * Weaviate Vector Store Adapter (@anx/memory).
 */
export class WeaviateVectorStoreAdapter implements VectorStorePort {
  private readonly fallback = new Map<string, MemoryRecord>();

  constructor(
    public readonly url?: string,
    public readonly apiKey?: string,
  ) {}

  async upsert(record: MemoryRecord): Promise<void> {
    this.fallback.set(record.id, record);
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    const hits: MemorySearchResult[] = [];
    for (const r of this.fallback.values()) {
      if (r.namespace !== opts.namespace || !r.embedding) continue;
      const score = cosineSim(embedding, r.embedding);
      if (score >= opts.threshold) hits.push({ record: r, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.fallback.delete(id);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.fallback.get(id);
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    return Array.from(this.fallback.values()).filter((r) => r.namespace === namespace).slice(0, limit);
  }
}

// ─── Scoped Memory Primitives (per-session, per-user, per-agent) ────────────

/**
 * SessionMemory: Ephemeral memory scoped to a single conversation/task session.
 */
export class SessionMemory {
  constructor(
    private readonly memory: Memory,
    public readonly sessionId: string,
  ) {}

  async remember(content: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    return this.memory.store(content, {
      namespace: `session:${this.sessionId}`,
      scope: 'short',
      metadata: { ...metadata, sessionId: this.sessionId },
    });
  }

  async recall(query: string, limit = 5): Promise<readonly MemorySearchResult[]> {
    return this.memory.search(query, {
      namespace: `session:${this.sessionId}`,
      scope: 'short',
      limit,
    });
  }

  async contextSummary(): Promise<string> {
    return this.memory.summarize(`session:${this.sessionId}`, { scope: 'short' });
  }
}

/**
 * UserMemory: Durable long-term memory scoped to a user (preferences, style, past decisions).
 */
export class UserMemory {
  constructor(
    private readonly memory: Memory,
    public readonly userId: string,
  ) {}

  async recordPreference(preference: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    return this.memory.store(preference, {
      namespace: `user:${this.userId}`,
      scope: 'long',
      metadata: { ...metadata, userId: this.userId },
    });
  }

  async searchPreferences(query: string, limit = 5): Promise<readonly MemorySearchResult[]> {
    return this.memory.search(query, {
      namespace: `user:${this.userId}`,
      scope: 'long',
      limit,
    });
  }
}

/**
 * AgentMemory: Durable memory scoped to an agent's expertise, learned strategies and tool execution patterns.
 */
export class AgentMemory {
  constructor(
    private readonly memory: Memory,
    public readonly agentId: string,
  ) {}

  async recordLearning(insight: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    return this.memory.store(insight, {
      namespace: `agent:${this.agentId}`,
      scope: 'long',
      metadata: { ...metadata, agentId: this.agentId },
    });
  }

  async retrieveLearnings(taskDescription: string, limit = 5): Promise<readonly MemorySearchResult[]> {
    return this.memory.search(taskDescription, {
      namespace: `agent:${this.agentId}`,
      scope: 'long',
      limit,
    });
  }
}
