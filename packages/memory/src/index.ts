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

// ─── Qdrant vector store adapter (real HTTP) ───────────────────────────────

/**
 * Qdrant adapter — talks to a Qdrant server's REST API.
 *
 * Qdrant organizes data into "collections"; we map each Memory namespace
 * to a Qdrant collection named `anx_<namespace>`. Each record's vector
 * is the embedding; the payload contains the full MemoryRecord (minus the
 * embedding, which Qdrant stores as the vector itself).
 *
 * Required Qdrant version: 1.x+ (REST API at ${url}/collections/...).
 *
 * Setup:
 *   docker run -p 6333:6333 qdrant/qdrant
 *   const store = new QdrantVectorStore('http://localhost:6333');
 */
export class QdrantVectorStore implements VectorStorePort {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  /** Cache of which collections we've already ensured exist. Avoids a PUT on every upsert. */
  private readonly ensuredCollections = new Set<string>();

  constructor(url: string, opts: { apiKey?: string } = {}) {
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  async upsert(record: MemoryRecord): Promise<void> {
    if (!record.embedding) {
      // Without an embedding, Qdrant can't index the record. Skip silently
      // — the InMemoryVectorStore would still hold it, but for Qdrant-only
      // deployments, callers must always supply an embedding.
      return;
    }
    const collection = this.collectionName(record.namespace);
    await this.ensureCollection(collection, record.embedding.length);

    const point = {
      id: record.id,
      vector: Array.from(record.embedding),
      payload: {
        namespace: record.namespace,
        scope: record.scope,
        contentType: record.contentType,
        content: record.content,
        metadata: record.metadata,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt?.toISOString(),
        tokenCount: record.tokenCount,
      },
    };

    const r = await fetch(`${this.baseUrl}/collections/${collection}/points?wait=true`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ points: [point] }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Qdrant upsert failed (${r.status}): ${text}`);
    }
  }

  async search(
    embedding: readonly number[],
    opts: { namespace: string; limit: number; threshold: number },
  ): Promise<readonly MemorySearchResult[]> {
    const collection = this.collectionName(opts.namespace);
    // Don't fail if the collection doesn't exist yet — there's just nothing to search.
    if (!(await this.collectionExists(collection))) return [];

    const r = await fetch(`${this.baseUrl}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        vector: Array.from(embedding),
        limit: opts.limit,
        score_threshold: opts.threshold,
        with_payload: true,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Qdrant search failed (${r.status}): ${text}`);
    }
    const body = (await r.json()) as {
      result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
    };
    return (body.result ?? []).map((hit) => ({
      record: this.payloadToRecord(hit.id, hit.payload),
      score: hit.score,
    }));
  }

  async delete(id: string): Promise<boolean> {
    // Qdrant requires the collection name to delete from. We don't know it
    // from the id alone — search all collections. For small deployments
    // this is fine; for large ones, callers should pass the namespace.
    // For now, return false (not found) since we can't resolve the collection.
    // A future API can take (namespace, id) to delete efficiently.
    void id;
    return false;
  }

  async deleteByNamespace(namespace: string, id: string): Promise<boolean> {
    const collection = this.collectionName(namespace);
    if (!(await this.collectionExists(collection))) return false;
    const r = await fetch(`${this.baseUrl}/collections/${collection}/points/delete?wait=true`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ points: [id] }),
    });
    return r.ok;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    // Same limitation as delete — we don't know the namespace from id alone.
    // Walk all collections starting with 'anx_'.
    const collections = await this.listCollections();
    for (const c of collections) {
      const r = await fetch(`${this.baseUrl}/collections/${c}/points/${id}`, {
        headers: this.headers(),
      });
      if (r.ok) {
        const body = (await r.json()) as { result?: { payload: Record<string, unknown> } };
        if (body.result?.payload) {
          return this.payloadToRecord(id, body.result.payload);
        }
      }
    }
    return undefined;
  }

  async list(namespace: string, limit: number): Promise<readonly MemoryRecord[]> {
    const collection = this.collectionName(namespace);
    if (!(await this.collectionExists(collection))) return [];
    // Use scroll API to list points (no vector needed).
    const r = await fetch(`${this.baseUrl}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ limit, with_payload: true, with_vector: false }),
    });
    if (!r.ok) return [];
    const body = (await r.json()) as {
      result?: { points: Array<{ id: string; payload: Record<string, unknown> }> };
    };
    return (body.result?.points ?? []).map((p) => this.payloadToRecord(p.id, p.payload));
  }

  // ─────────────────────────────────────────────────────────────────────────

  private collectionName(namespace: string): string {
    // Qdrant collection names must match ^[a-zA-Z0-9_-]+$ and be ≤255 chars.
    // Sanitize the namespace to ensure it's safe.
    const sanitized = namespace.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `anx_${sanitized}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  private async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (this.ensuredCollections.has(name)) return;
    if (await this.collectionExists(name)) {
      this.ensuredCollections.add(name);
      return;
    }
    const r = await fetch(`${this.baseUrl}/collections/${name}?timeout=60`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({
        vectors: { size: vectorSize, distance: 'Cosine' },
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Qdrant create collection '${name}' failed (${r.status}): ${text}`);
    }
    this.ensuredCollections.add(name);
  }

  private async collectionExists(name: string): Promise<boolean> {
    const r = await fetch(`${this.baseUrl}/collections/${name}`, {
      headers: this.headers(),
    });
    return r.ok;
  }

  private async listCollections(): Promise<string[]> {
    const r = await fetch(`${this.baseUrl}/collections`, { headers: this.headers() });
    if (!r.ok) return [];
    const body = (await r.json()) as {
      result?: { collections: Array<{ name: string }> };
    };
    return (body.result?.collections ?? []).map((c) => c.name);
  }

  private payloadToRecord(id: string, payload: Record<string, unknown>): MemoryRecord {
    return {
      id,
      namespace: (payload['namespace'] as string) ?? 'default',
      scope: (payload['scope'] as MemoryScope) ?? 'short',
      contentType: (payload['contentType'] as string) ?? 'text',
      content: (payload['content'] as string) ?? '',
      metadata: (payload['metadata'] as Record<string, unknown>) ?? {},
      createdAt: payload['createdAt'] ? new Date(payload['createdAt'] as string) : new Date(),
      expiresAt: payload['expiresAt'] ? new Date(payload['expiresAt'] as string) : undefined,
      tokenCount: (payload['tokenCount'] as number) ?? 0,
    };
  }
}

/**
 * Chroma adapter — talks to a Chroma server's REST API.
 *
 * Stub: Chroma's REST API surface is still in flux; this implementation
 * throws on construction with a clear message pointing operators to the
 * InMemoryVectorStore or QdrantVectorStore until a stable adapter lands.
 */
export class ChromaVectorStore implements VectorStorePort {
  constructor(_url: string) {
    throw new Error(
      'ChromaVectorStore not yet implemented. Use InMemoryVectorStore for development ' +
        'or QdrantVectorStore for production vector storage. Chroma adapter is planned for v0.5.',
    );
  }
  async upsert(): Promise<void> { throw new Error('not implemented'); }
  async search(): Promise<readonly MemorySearchResult[]> { throw new Error('not implemented'); }
  async delete(): Promise<boolean> { throw new Error('not implemented'); }
  async get(): Promise<MemoryRecord | undefined> { throw new Error('not implemented'); }
  async list(): Promise<readonly MemoryRecord[]> { throw new Error('not implemented'); }
}

/**
 * pgvector adapter — stub. Planned for v0.5 alongside the Postgres
 * persistence adapters.
 */
export class PgVectorStore implements VectorStorePort {
  constructor(_connectionString: string) {
    throw new Error('PgVectorStore not yet implemented (planned v0.5). Use QdrantVectorStore or InMemoryVectorStore.');
  }
  async upsert(): Promise<void> { throw new Error('not implemented'); }
  async search(): Promise<readonly MemorySearchResult[]> { throw new Error('not implemented'); }
  async delete(): Promise<boolean> { throw new Error('not implemented'); }
  async get(): Promise<MemoryRecord | undefined> { throw new Error('not implemented'); }
  async list(): Promise<readonly MemoryRecord[]> { throw new Error('not implemented'); }
}

/**
 * Local embeddings provider — uses the gateway's own /v1/embeddings endpoint.
 */
export class GatewayEmbeddingsProvider implements EmbeddingsProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string, private readonly model = 'text-embedding-3-small') {}

  async embed(text: string): Promise<readonly number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding ?? [];
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
    const results = await this.embedBatch([text]);
    return results[0] ?? [];
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
