/**
 * In-memory implementation of `CachePort`.
 *
 * Supports:
 *  - Exact-match prompt cache (key → value with TTL)
 *  - Optional semantic cache (vector similarity search via cosine)
 *
 * The semantic methods (`semantic` / `semanticStore`) are implemented as
 * a linear scan over all stored embeddings. This is intentionally simple —
 * for production-scale semantic caches, swap in a vector-store-backed
 * implementation (Qdrant, pgvector, etc.). The interface stays the same.
 *
 * All operations are O(1) for exact-match; `semantic` is O(n) over stored
 * embeddings, which is acceptable for caches up to ~10k entries.
 */

import type { CachePort } from './ports.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms; 0 = no expiry
  embedding?: readonly number[];
}

interface SemanticMatch {
  key: string;
  similarity: number;
  value: unknown;
}

export interface InMemoryCacheOptions {
  /** Default TTL in ms applied when `set` is called with ttlMs=0. Default: 0 (no expiry). */
  defaultTtlMs?: number;
  /** Cosine similarity threshold (0..1). Entries with similarity below this are not returned. Default: 0.92. */
  semanticThreshold?: number;
  /** Maximum entries before oldest non-expired entry is evicted. Default: 10_000. */
  maxEntries?: number;
}

export class InMemoryCache implements CachePort {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly semanticThreshold: number;
  private readonly maxEntries: number;

  private hits = 0;
  private misses = 0;

  constructor(opts: InMemoryCacheOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 0;
    this.semanticThreshold = opts.semanticThreshold ?? 0.92;
    this.maxEntries = opts.maxEntries ?? 10_000;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt !== 0 && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    // Evict if at capacity — drop oldest entry (Map preserves insertion order).
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    const effectiveTtl = ttlMs === 0 ? this.defaultTtlMs : ttlMs;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: effectiveTtl === 0 ? 0 : Date.now() + effectiveTtl,
    };
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Semantic search: linear scan over all entries that have an embedding,
   * return the one with highest cosine similarity above the threshold.
   *
   * Requires the cache to be configured with an `embed` function (so that
   * `semanticStore` could compute embeddings at insert time).
   */
  async semantic(
    embedding: readonly number[],
    threshold: number,
  ): Promise<{ key: string; similarity: number; value: unknown } | undefined> {
    const effectiveThreshold = threshold ?? this.semanticThreshold;
    let best: SemanticMatch | undefined;
    for (const [key, entry] of this.store) {
      if (!entry.embedding) continue;
      if (entry.expiresAt !== 0 && entry.expiresAt < Date.now()) {
        this.store.delete(key);
        continue;
      }
      const sim = cosineSimilarity(embedding, entry.embedding);
      if (sim < effectiveThreshold) continue;
      if (!best || sim > best.similarity) {
        best = { key, similarity: sim, value: entry.value };
      }
    }
    return best;
  }

  /**
   * Store a value with its embedding so `semantic` can find it later.
   * If no `embed` function was configured, the embedding provided here is
   * used directly.
   */
  async semanticStore(
    embedding: readonly number[],
    key: string,
    value: unknown,
    ttlMs: number,
  ): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    const effectiveTtl = ttlMs === 0 ? this.defaultTtlMs : ttlMs;
    this.store.set(key, {
      value,
      expiresAt: effectiveTtl === 0 ? 0 : Date.now() + effectiveTtl,
      embedding,
    });
  }

  stats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  /** Clears all entries. Mainly for tests. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 if either
 * vector is all-zero.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
