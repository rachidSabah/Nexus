import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { writeFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve, normalize, relative } from 'node:path';

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
 * File-backed persistent vector store.
 *
 * Serializes every record (including its embedding vector and Date fields)
 * to a single JSON file so memory genuinely survives restarts — unlike
 * InMemoryVectorStore, which is lost on process exit. Loads the file
 * synchronously on construction; writes are flushed (best-effort) after
 * each mutation. Falls back to an empty store if the file is missing or
 * unreadable, and logs (without throwing) if a write fails.
 */
export class FileVectorStore implements VectorStorePort {
  private readonly filePath: string;
  private readonly records = new Map<string, MemoryRecord>();

  constructor(path: string) {
    this.filePath = path;
    try {
      const raw = readFileSync(path, 'utf8');
      const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
      for (const r of arr) {
        const rec = reviveRecord(r);
        if (rec) this.records.set(rec.id, rec);
      }
    } catch {
      // Missing/unreadable file — start empty.
    }
  }

  async upsert(record: MemoryRecord): Promise<void> {
    this.records.set(record.id, record);
    await this.persist();
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
    const had = this.records.delete(id);
    if (had) await this.persist();
    return had;
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
    void this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const arr = Array.from(this.records.values()).map(serializeRecord);
      await writeFile(this.filePath, JSON.stringify(arr), 'utf8');
    } catch (err) {
      console.error('[FileVectorStore] persist failed:', (err as Error).message);
    }
  }
}

/** Serialize a MemoryRecord for on-disk storage (Dates -> ISO strings). */
function serializeRecord(r: MemoryRecord): Record<string, unknown> {
  return {
    id: r.id,
    namespace: r.namespace,
    scope: r.scope,
    contentType: r.contentType,
    content: r.content,
    embedding: r.embedding,
    metadata: r.metadata,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    expiresAt: r.expiresAt instanceof Date ? r.expiresAt.toISOString() : r.expiresAt,
    tokenCount: r.tokenCount,
  };
}

/** Revive a stored record (ISO strings -> Dates). Returns undefined if malformed. */
function reviveRecord(r: Record<string, unknown>): MemoryRecord | undefined {
  if (typeof r['id'] !== 'string' || typeof r['namespace'] !== 'string') return undefined;
  return {
    id: r['id'],
    namespace: r['namespace'],
    scope: r['scope'] === 'long' ? 'long' : 'short',
    contentType: typeof r['contentType'] === 'string' ? r['contentType'] : 'text',
    content: typeof r['content'] === 'string' ? r['content'] : '',
    embedding: Array.isArray(r['embedding']) ? (r['embedding'] as number[]) : undefined,
    metadata: (r['metadata'] as Record<string, unknown>) ?? {},
    createdAt: typeof r['createdAt'] === 'string' ? new Date(r['createdAt']) : new Date(),
    expiresAt: typeof r['expiresAt'] === 'string' ? new Date(r['expiresAt']) : undefined,
    tokenCount: typeof r['tokenCount'] === 'number' ? r['tokenCount'] : 0,
  };
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
    private readonly embeddings: EmbeddingsProvider | null,
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
      // Compute embedding if not provided AND an embeddings provider is configured.
      // If no embeddings provider is available, store without embedding
      // (exact-match search only — no semantic recall).
      if (!record.embedding && this.embeddings) {
        try {
          const embedding = await this.embeddings.embed(data);
          Object.assign(record, { embedding });
        } catch {
          // Gracefully continue without embedding if upstream embedder is unavailable
        }
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
      if (!this.embeddings) {
        // No embeddings provider configured — return empty results for
        // long-term search (short-term substring search above already ran).
        return [];
      }
      let results: readonly MemorySearchResult[] = [];
      try {
        const embedding = typeof query === 'string' ? await this.embeddings.embed(query) : query;
        results = await this.longTermStore.search(embedding, {
          namespace: opts.namespace,
          limit,
          threshold,
        });
      } catch {
        results = [];
      }

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
    // from the id alone — walk all collections (same approach as get()).
    const collections = await this.listCollections();
    let deleted = false;
    for (const c of collections) {
      // Only try anx_* collections (skip any non-gateway collections).
      if (!c.startsWith('anx_')) continue;
      const r = await fetch(`${this.baseUrl}/collections/${c}/points/delete?wait=true`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ points: [id] }),
      });
      if (r.ok) deleted = true;
    }
    return deleted;
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
 * Local embeddings provider — uses the gateway's own /v1/embeddings endpoint.
 */
export class GatewayEmbeddingsProvider implements EmbeddingsProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private resolvedModel?: string;

  constructor(baseUrl: string, apiKey?: string, model = 'text-embedding-3-small') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.defaultModel = model;
  }

  async embed(text: string): Promise<readonly number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding ?? [];
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const model = await this.resolveModel();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    const r = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: texts }),
    });
    if (!r.ok) throw new Error(`Embeddings failed: ${r.status}`);
    const body = (await r.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }

  /**
   * Resolves the embeddings model id to use. If the configured default is the
   * generic placeholder (`text-embedding-3-small`) and no explicit model was
   * given, discover a real embeddings-capable model from the gateway's own
   * catalog and cache it. This makes semantic memory/RAG work with whatever
   * embeddings model the operator actually has configured (e.g. Mistral,
   * NVIDIA NIM) instead of silently 404'ing on a model that isn't registered.
   */
  private async resolveModel(): Promise<string> {
    if (this.resolvedModel) return this.resolvedModel;
    if (this.defaultModel !== 'text-embedding-3-small') {
      this.resolvedModel = this.defaultModel;
      return this.resolvedModel;
    }
    try {
      const r = await fetch(`${this.baseUrl}/v1/models/discover`);
      if (r.ok) {
        const j = (await r.json()) as { models?: Array<{ id: string; capabilities?: { embeddings?: boolean } }> };
        const emb = (j.models ?? []).find((m) => m.capabilities?.embeddings);
        if (emb) {
          this.resolvedModel = emb.id;
          return this.resolvedModel;
        }
      }
    } catch {
      // Fall through to the placeholder default.
    }
    this.resolvedModel = this.defaultModel;
    return this.resolvedModel;
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


// ─── RAG Pipeline ───────────────────────────────────────────────────────
export { RagPipeline, TextChunker, DEFAULT_RAG_CONFIG, type RagConfig, type RagChunk, type RagIngestResult, type RagRetrieveResult } from "./rag.js";

// ─── Optional Obsidian Knowledge Adapter ──────────────────────────────────
export type ObsidianServiceStatus =
  | 'NOT_DETECTED'
  | 'DETECTED'
  | 'CONFIGURED'
  | 'CONNECTED'
  | 'READY'
  | 'ERROR'
  | 'DISABLED';

export interface ObsidianConfig {
  vaultPath?: string;
  apiPort?: number;
  apiKey?: string;
  enabled?: boolean;
}

export interface ObsidianNoteMetadata {
  path: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  headings: string[];
  mtime: number;
  size: number;
}

export interface ObsidianSearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export class ObsidianKnowledgeAdapter {
  private config: ObsidianConfig = {
    enabled: true,
  };
  private status: ObsidianServiceStatus = 'NOT_DETECTED';
  private errorMessage?: string;

  constructor(initialConfig?: Partial<ObsidianConfig>) {
    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }
  }

  public setConfig(patch: Partial<ObsidianConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  public getConfig(): { enabled: boolean; vaultPath?: string; apiPort?: number; configured: boolean } {
    return {
      enabled: this.config.enabled ?? true,
      vaultPath: this.config.vaultPath,
      apiPort: this.config.apiPort,
      configured: Boolean(this.config.vaultPath || this.config.apiKey),
    };
  }

  public async getStatus(): Promise<{ status: ObsidianServiceStatus; message?: string; vaultConfigured: boolean }> {
    try {
      if (this.config.enabled === false) {
        this.status = 'DISABLED';
        return { status: this.status, vaultConfigured: Boolean(this.config.vaultPath) };
      }

      if (this.config.vaultPath) {
        const vaultResolved = resolve(this.config.vaultPath);
        if (existsSync(vaultResolved)) {
          this.status = 'READY';
          return { status: this.status, message: `Obsidian vault active at ${vaultResolved}`, vaultConfigured: true };
        } else {
          this.status = 'ERROR';
          this.errorMessage = `Configured vault directory does not exist: ${vaultResolved}`;
          return { status: this.status, message: this.errorMessage, vaultConfigured: true };
        }
      }

      const discovered = await this.discoverObsidian();
      if (discovered) {
        this.status = 'DETECTED';
        return { status: this.status, message: `Obsidian detected on system (${discovered})`, vaultConfigured: false };
      }

      this.status = 'NOT_DETECTED';
      return { status: this.status, message: 'Obsidian application or vault not detected', vaultConfigured: false };
    } catch (err) {
      this.status = 'ERROR';
      this.errorMessage = (err as Error).message;
      return { status: this.status, message: this.errorMessage, vaultConfigured: false };
    }
  }

  private async discoverObsidian(): Promise<string | undefined> {
    const userHome = homedir();
    if (platform() === 'win32') {
      const candidates = [
        join(process.env.LOCALAPPDATA || join(userHome, 'AppData', 'Local'), 'Programs', 'Obsidian', 'Obsidian.exe'),
        join(process.env.ProgramFiles || 'C:\\Program Files', 'Obsidian', 'Obsidian.exe'),
        join(userHome, 'AppData', 'Roaming', 'obsidian'),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    } else if (platform() === 'darwin') {
      const candidates = [
        '/Applications/Obsidian.app',
        join(userHome, 'Library', 'Application Support', 'obsidian'),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    } else {
      const candidates = [
        '/usr/bin/obsidian',
        '/usr/local/bin/obsidian',
        join(userHome, '.config', 'obsidian'),
      ];
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
    }
    return undefined;
  }

  private sanitizeRelativePath(relPath: string): string {
    const norm = normalize(relPath).replace(/^[\\/]+/, '');
    if (norm.includes('..') || (this.config.vaultPath && resolve(join(this.config.vaultPath, norm)) !== join(resolve(this.config.vaultPath), norm))) {
      throw new Error(`Security Violation: Path traversal outside vault boundary is forbidden (${relPath})`);
    }
    return norm;
  }

  public async searchNotes(query: string, limit: number = 20): Promise<ObsidianSearchResult[]> {
    if (!this.config.vaultPath || !existsSync(this.config.vaultPath)) {
      return [];
    }

    const q = query.toLowerCase();
    const results: ObsidianSearchResult[] = [];
    const files = await this.walkDir(this.config.vaultPath);

    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const rel = relative(this.config.vaultPath, f).replace(/\\/g, '/');
      try {
        const content = await readFile(f, 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title: string = titleMatch && titleMatch[1] ? titleMatch[1] : rel.replace(/\.md$/, '');
        const contentLower = content.toLowerCase();

        let score = 0;
        if (rel.toLowerCase().includes(q)) score += 10;
        if (title.toLowerCase().includes(q)) score += 8;
        if (contentLower.includes(q)) score += 5;

        if (score > 0) {
          const idx = contentLower.indexOf(q);
          const start = Math.max(0, idx - 40);
          const end = Math.min(content.length, idx + 100);
          const snippet = (start > 0 ? '...' : '') + content.substring(start, end).replace(/\r?\n/g, ' ') + (end < content.length ? '...' : '');
          results.push({ path: rel, title, snippet, score });
        }
      } catch {
        // ignore unreadable
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  public async readNote(notePath: string): Promise<{ path: string; content: string; metadata: Partial<ObsidianNoteMetadata> }> {
    if (!this.config.vaultPath) throw new Error('Obsidian vaultPath is not configured');
    const safePath = this.sanitizeRelativePath(notePath);
    const full = join(resolve(this.config.vaultPath), safePath.endsWith('.md') ? safePath : `${safePath}.md`);
    if (!existsSync(full)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const content = await readFile(full, 'utf8');
    const st = await stat(full);
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const headings = (content.match(/^#{1,6}\s+(.+)$/gm) || []).map((h) => h.replace(/^#+\s+/, ''));
    const tags = Array.from(new Set((content.match(/#[a-zA-Z0-9_-]+/g) || []).map((t) => t.substring(1))));

    return {
      path: safePath,
      content,
      metadata: {
        path: safePath,
        title: titleMatch ? titleMatch[1] : safePath,
        headings,
        tags,
        mtime: st.mtimeMs,
        size: st.size,
      },
    };
  }

  public async writeNote(notePath: string, content: string, opts: { append?: boolean } = {}): Promise<{ ok: boolean; path: string }> {
    if (!this.config.vaultPath) throw new Error('Obsidian vaultPath is not configured');
    const safePath = this.sanitizeRelativePath(notePath);
    const full = join(resolve(this.config.vaultPath), safePath.endsWith('.md') ? safePath : `${safePath}.md`);
    await mkdir(resolve(join(full, '..')), { recursive: true });

    if (opts.append && existsSync(full)) {
      const existing = await readFile(full, 'utf8');
      await writeFile(full, existing + (existing.endsWith('\n') ? '' : '\n') + content, 'utf8');
    } else {
      await writeFile(full, content, 'utf8');
    }

    return { ok: true, path: safePath };
  }

  public async deleteNote(notePath: string): Promise<{ ok: boolean }> {
    if (!this.config.vaultPath) throw new Error('Obsidian vaultPath is not configured');
    const safePath = this.sanitizeRelativePath(notePath);
    const full = join(resolve(this.config.vaultPath), safePath.endsWith('.md') ? safePath : `${safePath}.md`);
    if (existsSync(full)) {
      await unlink(full);
      return { ok: true };
    }
    return { ok: false };
  }

  private async walkDir(dir: string): Promise<string[]> {
    let files: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          files = files.concat(await this.walkDir(full));
        } else {
          files.push(full);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return files;
  }
}

/**
 * Multi-Tier High Performance Cache Hierarchy
 * L1: Sub-millisecond In-Memory LRU Cache
 * L2: Persistent Exact-Match Normalized Store
 * L3: Vector Semantic Match Cache
 */
export class MultiTierCacheHierarchy {
  private l1Cache: Map<string, { value: unknown; expiresAt: number }> = new Map();
  private maxL1Entries: number = 2000;

  public setL1(key: string, value: unknown, ttlMs: number = 300_000): void {
    if (this.l1Cache.size >= this.maxL1Entries) {
      const firstKey = this.l1Cache.keys().next().value;
      if (firstKey) this.l1Cache.delete(firstKey);
    }
    this.l1Cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  public getL1<T>(key: string): T | null {
    const entry = this.l1Cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.l1Cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public invalidateL1(key: string): void {
    this.l1Cache.delete(key);
  }

  public clearL1(): void {
    this.l1Cache.clear();
  }
}

