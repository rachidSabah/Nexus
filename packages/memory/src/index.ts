import { randomUUID } from 'node:crypto';

import {
  buildEvent,
  type EventBusPort,
  type MemoryCreatedEvent,
  type MemoryRetrievedEvent,
} from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Memory System
 *
 * Two scopes:
 *   - Short-term: in-memory, per-session. Cleared when the session ends.
 *     Used for current conversation, active workflow context.
 *   - Long-term: persisted to a vector store. Survives restarts.
 *     Used for user preferences, project knowledge, codebase knowledge.
 *
 * Vector store adapters:
 *   - InMemoryVectorStore (default, no external deps)
 *   - QdrantVectorStore    (HTTP adapter — QDRANT_URL)
 *   - ChromaVectorStore    (HTTP adapter — CHROMA_URL)
 *   - PgVectorStore        (PostgreSQL + pgvector — DATABASE_URL)
 *
 * All adapters implement the VectorStorePort interface.
 *
 * The Memory interface mirrors what the spec requires:
 *   store(data) / search(query) / delete(id) / summarize()
 * ───────────────────────────────────────────────────────────────────────────
 */

export type MemoryScope = 'short' | 'long';

export interface MemoryRecord {
  readonly id: string;
  readonly namespace: string;
  readonly scope: MemoryScope;
  readonly contentType: string; // 'text' | 'json' | 'code' | 'conversation' | ...
  readonly content: string;
  readonly embedding?: readonly number[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly tokenCount: number;
}

export interface MemorySearchResult {
  readonly record: MemoryRecord;
  readonly score: number;
}

export interface MemoryStoreOptions {
  readonly namespace: string;
  readonly scope: MemoryScope;
  readonly contentType?: string;
  readonly metadata?: Record<string, unknown>;
  readonly ttlMs?: number;
  readonly embedding?: readonly number[];
}

/**
 * The Memory port — what application code interacts with.
 */
export interface Memory {
  store(data: string, opts: MemoryStoreOptions): Promise<MemoryRecord>;
  search(query: string | readonly number[], opts: {
    namespace: string;
    scope?: MemoryScope;
    limit?: number;
    threshold?: number;
  }): Promise<readonly MemorySearchResult[]>;
  delete(id: string): Promise<boolean>;
  summarize(namespace: string, opts?: { scope?: MemoryScope; maxRecords?: number }): Promise<string>;
  get(id: string): Promise<MemoryRecord | undefined>;
  list(namespace: string, opts?: { scope?: MemoryScope; limit?: number }): Promise<readonly MemoryRecord[]>;
}

/**
 * Vector store port. Adapters implement this.
 */
export interface VectorStorePort {
  upsert(record: MemoryRecord): Promise<void>;
  search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]>;
  delete(id: string): Promise<boolean>;
  get(id: string): Promise<MemoryRecord | undefined>;
  list(namespace: string, limit: number): Promise<readonly MemoryRecord[]>;
}

/**
 * Embeddings port. The gateway's own OpenAI-compatible /v1/embeddings
 * endpoint can be used (via an EmbeddingsClient), or a local embeddings
 * model.
 */
export interface EmbeddingsProvider {
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/**
 * Token counter port. Defaults to a naive whitespace-based estimator.
 */
export interface TokenCounter {
  count(text: string): number;
}

export class NaiveTokenCounter implements TokenCounter {
  count(text: string): number {
    // ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }
}

// ─── Default: InMemoryVectorStore ───────────────────────────────────────────

export class InMemoryVectorStore implements VectorStorePort {
  private readonly records = new Map<string, MemoryRecord>();

  async upsert(record: MemoryRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    const candidates = Array.from(this.records.values()).filter(
      (r) => r.namespace === opts.namespace && r.embedding !== undefined,
    );
    const scored = candidates.map((record) => ({
      record,
      score: cosineSimilarity(embedding, record.embedding!),
    }));
    return scored
      .filter((s) => s.score >= opts.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.records.get(id);
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    return Array.from(this.records.values())
      .filter((r) => r.namespace === namespace)
      .slice(-limit);
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Cosine similarity — the standard metric for embeddings.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Default: DefaultMemory implementation ──────────────────────────────────

export class DefaultMemory implements Memory {
  private readonly shortTerm = new Map<string, MemoryRecord>();
  private readonly tokens: TokenCounter;

  constructor(
    private readonly longTermStore: VectorStorePort,
    private readonly embeddings: EmbeddingsProvider,
    private readonly events: EventBusPort,
    opts: { tokenCounter?: TokenCounter } = {},
  ) {
    this.tokens = opts.tokenCounter ?? new NaiveTokenCounter();
  }

  async store(data: string, opts: MemoryStoreOptions): Promise<MemoryRecord> {
    const id = randomUUID();
    const now = new Date();
    const record: MemoryRecord = {
      id,
      namespace: opts.namespace,
      scope: opts.scope,
      contentType: opts.contentType ?? 'text',
      content: data,
      embedding: opts.embedding,
      metadata: opts.metadata ?? {},
      createdAt: now,
      expiresAt: opts.ttlMs ? new Date(now.getTime() + opts.ttlMs) : undefined,
      tokenCount: this.tokens.count(data),
    };

    if (opts.scope === 'short') {
      this.shortTerm.set(id, record);
    } else {
      // Compute embedding if not provided
      if (!record.embedding) {
        const embedding = await this.embeddings.embed(data);
        Object.assign(record, { embedding });
      }
      await this.longTermStore.upsert(record);
    }

    await this.events.publish(
      buildEvent<MemoryCreatedEvent>(
        'memory.created',
        {
          memoryId: id,
          scope: opts.scope,
          namespace: opts.namespace,
          contentType: record.contentType,
          tokenCount: record.tokenCount,
        },
      ),
    );

    return record;
  }

  async search(query: string | readonly number[], opts: {
    namespace: string;
    scope?: MemoryScope;
    limit?: number;
    threshold?: number;
  }): Promise<readonly MemorySearchResult[]> {
    const limit = opts.limit ?? 10;
    const threshold = opts.threshold ?? 0.7;

    // Short-term: simple substring match
    if (opts.scope === 'short' || opts.scope === undefined) {
      const q = typeof query === 'string' ? query.toLowerCase() : '';
      const shortResults: MemorySearchResult[] = [];
      for (const record of this.shortTerm.values()) {
        if (record.namespace !== opts.namespace) continue;
        if (record.expiresAt && record.expiresAt < new Date()) continue;
        if (q && record.content.toLowerCase().includes(q)) {
          shortResults.push({ record, score: 1.0 });
        }
      }
      if (opts.scope === 'short') {
        return shortResults.slice(0, limit);
      }
    }

    // Long-term: vector search
    if (opts.scope === 'long' || opts.scope === undefined) {
      const embedding = typeof query === 'string' ? await this.embeddings.embed(query) : query;
      const results = await this.longTermStore.search(embedding, {
        namespace: opts.namespace,
        limit,
        threshold,
      });

      await this.events.publish(
        buildEvent<MemoryRetrievedEvent>(
          'memory.retrieved',
          {
            namespace: opts.namespace,
            query: typeof query === 'string' ? query.slice(0, 200) : '<vector>',
            matches: results.length,
            topScore: results[0]?.score ?? 0,
          },
        ),
      );

      if (opts.scope === undefined) {
        // Merge short + long
        const q = typeof query === 'string' ? query.toLowerCase() : '';
        const shortResults: MemorySearchResult[] = [];
        for (const record of this.shortTerm.values()) {
          if (record.namespace !== opts.namespace) continue;
          if (q && record.content.toLowerCase().includes(q)) {
            shortResults.push({ record, score: 1.0 });
          }
        }
        return [...shortResults, ...results].slice(0, limit);
      }
      return results;
    }

    return [];
  }

  async delete(id: string): Promise<boolean> {
    if (this.shortTerm.has(id)) {
      return this.shortTerm.delete(id);
    }
    return this.longTermStore.delete(id);
  }

  async summarize(namespace: string, opts?: { scope?: MemoryScope; maxRecords?: number }): Promise<string> {
    const records = await this.list(namespace, { scope: opts?.scope, limit: opts?.maxRecords ?? 50 });
    if (records.length === 0) return '';
    const parts = records.map((r) => `[${r.createdAt.toISOString()}] (${r.contentType}): ${r.content.slice(0, 500)}`);
    return `Memory summary for namespace "${namespace}" (${records.length} records):\n\n${parts.join('\n\n')}`;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    return this.shortTerm.get(id) ?? this.longTermStore.get(id);
  }

  async list(namespace: string, opts?: { scope?: MemoryScope; limit?: number }): Promise<readonly MemoryRecord[]> {
    const limit = opts?.limit ?? 100;
    if (opts?.scope === 'short') {
      return Array.from(this.shortTerm.values())
        .filter((r) => r.namespace === namespace)
        .slice(-limit);
    }
    if (opts?.scope === 'long') {
      return this.longTermStore.list(namespace, limit);
    }
    // Both scopes
    const short = Array.from(this.shortTerm.values()).filter((r) => r.namespace === namespace);
    const long = await this.longTermStore.list(namespace, limit);
    return [...short, ...long].slice(-limit);
  }

  /**
   * Sweep expired short-term memories.
   */
  sweepExpired(): number {
    const now = new Date();
    let swept = 0;
    for (const [id, record] of this.shortTerm) {
      if (record.expiresAt && record.expiresAt < now) {
        this.shortTerm.delete(id);
        swept++;
      }
    }
    return swept;
  }
}

// ─── Stub vector store adapters (HTTP) ──────────────────────────────────────

/**
 * Qdrant adapter — POST to `${QDRANT_URL}/collections/${namespace}/points/search`.
 * Stub: full implementation in adapters/qdrant.ts.
 */
export class QdrantVectorStore implements VectorStorePort {
  constructor(private readonly url: string) {}

  async upsert(_record: MemoryRecord): Promise<void> {
    // TODO: implement HTTP call to Qdrant
    throw new Error('QdrantVectorStore upsert not yet implemented — use InMemoryVectorStore for now');
  }
  async search(): Promise<readonly MemorySearchResult[]> {
    throw new Error('QdrantVectorStore search not yet implemented');
  }
  async delete(): Promise<boolean> {
    throw new Error('QdrantVectorStore delete not yet implemented');
  }
  async get(): Promise<MemoryRecord | undefined> {
    throw new Error('QdrantVectorStore get not yet implemented');
  }
  async list(): Promise<readonly MemoryRecord[]> {
    throw new Error('QdrantVectorStore list not yet implemented');
  }
}

/**
 * Chroma adapter — stub.
 */
export class ChromaVectorStore implements VectorStorePort {
  constructor(private readonly url: string) {}
  async upsert(): Promise<void> { throw new Error('ChromaVectorStore not yet implemented'); }
  async search(): Promise<readonly MemorySearchResult[]> { throw new Error('ChromaVectorStore not yet implemented'); }
  async delete(): Promise<boolean> { throw new Error('ChromaVectorStore not yet implemented'); }
  async get(): Promise<MemoryRecord | undefined> { throw new Error('ChromaVectorStore not yet implemented'); }
  async list(): Promise<readonly MemoryRecord[]> { throw new Error('ChromaVectorStore not yet implemented'); }
}

/**
 * pgvector adapter — stub.
 */
export class PgVectorStore implements VectorStorePort {
  constructor(private readonly connectionString: string) {}
  async upsert(): Promise<void> { throw new Error('PgVectorStore not yet implemented'); }
  async search(): Promise<readonly MemorySearchResult[]> { throw new Error('PgVectorStore not yet implemented'); }
  async delete(): Promise<boolean> { throw new Error('PgVectorStore not yet implemented'); }
  async get(): Promise<MemoryRecord | undefined> { throw new Error('PgVectorStore not yet implemented'); }
  async list(): Promise<readonly MemoryRecord[]> { throw new Error('PgVectorStore not yet implemented'); }
}

/**
 * Local embeddings provider — uses the gateway's own /v1/embeddings endpoint.
 */
export class GatewayEmbeddingsProvider implements EmbeddingsProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string, private readonly model = 'text-embedding-3-small') {}

  async embed(text: string): Promise<readonly number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    const r = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!r.ok) throw new Error(`Embeddings failed: ${r.status}`);
    const body = (await r.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }
}

/**
 * Fake embeddings provider for tests — produces a deterministic 8-dim vector.
 */
export class FakeEmbeddingsProvider implements EmbeddingsProvider {
  async embed(text: string): Promise<readonly number[]> {
    return this.embedBatch([text])[0]!;
  }

  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.resolve(
      texts.map((text) => {
        // Hash-based deterministic embedding into 8 dimensions
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % 8]! += text.charCodeAt(i);
        }
        // Normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map((v) => v / norm);
      }),
    );
  }
}
