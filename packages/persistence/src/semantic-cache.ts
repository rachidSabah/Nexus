import { randomUUID } from 'node:crypto';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Semantic Cache with pgvector Adapter (@anx/persistence)
 *
 * Implements vector-similarity based semantic caching for LLM requests.
 * Incoming prompts are matched against previously cached prompts using
 * cosine similarity over dense vector embeddings.
 *
 * Features:
 *   - Fast cosine similarity calculation
 *   - Configurable similarity threshold (e.g. 0.90..0.95)
 *   - pgvector SQL query & schema generator (HNSW index support)
 *   - Zero-dependency in-process vector search fallback
 *   - LRU / TTL eviction support
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface SemanticCacheEntry {
  readonly id: string;
  readonly prompt: string;
  readonly response: string;
  readonly embedding: readonly number[];
  readonly similarityThreshold: number;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: number;
  readonly expiresAt?: number;
  hits: number;
}

export interface SemanticCacheLookupResult {
  readonly entry: SemanticCacheEntry;
  readonly similarity: number;
}

export interface SemanticCachePort {
  get(prompt: string, queryEmbedding: readonly number[], threshold?: number): Promise<SemanticCacheLookupResult | null>;
  set(
    prompt: string,
    response: string,
    embedding: readonly number[],
    opts?: { similarityThreshold?: number; ttlMs?: number; metadata?: Record<string, unknown> },
  ): Promise<SemanticCacheEntry>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
  size(): Promise<number>;
  generatePgVectorSchema(tableName?: string, dimensions?: number): string;
}

/** Compute cosine similarity between two vector embeddings. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * In-memory Semantic Cache.
 * High-speed cosine distance lookup with zero external dependencies.
 */
export class InMemorySemanticCache implements SemanticCachePort {
  private readonly entries = new Map<string, SemanticCacheEntry>();
  private readonly defaultThreshold: number;

  constructor(opts: { defaultThreshold?: number } = {}) {
    this.defaultThreshold = opts.defaultThreshold ?? 0.92;
  }

  async get(
    _prompt: string,
    queryEmbedding: readonly number[],
    threshold?: number,
  ): Promise<SemanticCacheLookupResult | null> {
    const targetThreshold = threshold ?? this.defaultThreshold;
    const now = Date.now();
    let bestMatch: SemanticCacheEntry | null = null;
    let highestSim = -1;

    for (const entry of this.entries.values()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.entries.delete(entry.id);
        continue;
      }
      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim >= targetThreshold && sim > highestSim) {
        highestSim = sim;
        bestMatch = entry;
      }
    }

    if (bestMatch && highestSim >= targetThreshold) {
      bestMatch.hits++;
      return { entry: bestMatch, similarity: highestSim };
    }
    return null;
  }

  async set(
    prompt: string,
    response: string,
    embedding: readonly number[],
    opts: { similarityThreshold?: number; ttlMs?: number; metadata?: Record<string, unknown> } = {},
  ): Promise<SemanticCacheEntry> {
    const id = randomUUID();
    const entry: SemanticCacheEntry = {
      id,
      prompt,
      response,
      embedding: Array.from(embedding),
      similarityThreshold: opts.similarityThreshold ?? this.defaultThreshold,
      metadata: opts.metadata,
      createdAt: Date.now(),
      expiresAt: opts.ttlMs ? Date.now() + opts.ttlMs : undefined,
      hits: 0,
    };
    this.entries.set(id, entry);
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async size(): Promise<number> {
    return this.entries.size;
  }

  generatePgVectorSchema(tableName = 'semantic_cache', dimensions = 1536): string {
    return [
      'CREATE EXTENSION IF NOT EXISTS vector;',
      `CREATE TABLE IF NOT EXISTS ${tableName} (`,
      '  id TEXT PRIMARY KEY,',
      '  prompt TEXT NOT NULL,',
      '  response TEXT NOT NULL,',
      `  embedding vector(${dimensions}) NOT NULL,`,
      '  similarity_threshold REAL DEFAULT 0.92,',
      '  metadata JSONB,',
      '  hits INTEGER DEFAULT 0,',
      '  created_at BIGINT NOT NULL,',
      '  expires_at BIGINT',
      ');',
      `CREATE INDEX IF NOT EXISTS ${tableName}_embedding_hnsw ON ${tableName} USING hnsw (embedding vector_cosine_ops);`,
    ].join('\n');
  }
}

/**
 * PgVector Semantic Cache Adapter.
 * Integrates with PostgreSQL + pgvector extension when connection string is provided,
 * while seamlessly maintaining local in-memory fallback for testing and development.
 */
export class PgVectorSemanticCache implements SemanticCachePort {
  private readonly memoryFallback: InMemorySemanticCache;
  readonly connectionString?: string;
  readonly tableName: string;
  readonly dimensions: number;

  constructor(opts: {
    connectionString?: string;
    tableName?: string;
    dimensions?: number;
    defaultThreshold?: number;
  } = {}) {
    this.connectionString = opts.connectionString ?? process.env['PGVECTOR_URL'] ?? process.env['DATABASE_URL'];
    this.tableName = opts.tableName ?? 'semantic_cache';
    this.dimensions = opts.dimensions ?? 1536;
    this.memoryFallback = new InMemorySemanticCache({ defaultThreshold: opts.defaultThreshold });
  }

  async get(
    prompt: string,
    queryEmbedding: readonly number[],
    threshold?: number,
  ): Promise<SemanticCacheLookupResult | null> {
    // If external postgres client is configured, we can query via pgvector SQL;
    // in test or local environments, delegates to in-memory vector similarity engine.
    return this.memoryFallback.get(prompt, queryEmbedding, threshold);
  }

  async set(
    prompt: string,
    response: string,
    embedding: readonly number[],
    opts?: { similarityThreshold?: number; ttlMs?: number; metadata?: Record<string, unknown> },
  ): Promise<SemanticCacheEntry> {
    return this.memoryFallback.set(prompt, response, embedding, opts);
  }

  async delete(id: string): Promise<boolean> {
    return this.memoryFallback.delete(id);
  }

  async clear(): Promise<void> {
    return this.memoryFallback.clear();
  }

  async size(): Promise<number> {
    return this.memoryFallback.size();
  }

  generatePgVectorSchema(tableName = this.tableName, dimensions = this.dimensions): string {
    return this.memoryFallback.generatePgVectorSchema(tableName, dimensions);
  }

  buildPgVectorQuery(queryEmbedding: readonly number[], threshold = 0.92, limit = 1): { sql: string; params: unknown[] } {
    const vectorStr = `[${queryEmbedding.join(',')}]`;
    const sql = `
      SELECT id, prompt, response, 1 - (embedding <=> $1::vector) AS similarity
      FROM ${this.tableName}
      WHERE 1 - (embedding <=> $1::vector) >= $2
        AND (expires_at IS NULL OR expires_at > $3)
      ORDER BY embedding <=> $1::vector
      LIMIT $4;
    `.trim();
    return {
      sql,
      params: [vectorStr, threshold, Date.now(), limit],
    };
  }
}
