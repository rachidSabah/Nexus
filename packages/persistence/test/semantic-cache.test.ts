import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  InMemorySemanticCache,
  PgVectorSemanticCache,
} from '../src/semantic-cache.js';

describe('Semantic Cache & pgvector adapter', () => {
  it('correctly calculates cosine similarity', () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [0.7071, 0.7071, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 4);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0, 4);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(0.7071, 3);
  });

  it('stores and retrieves cache entry on semantic match', async () => {
    const cache = new InMemorySemanticCache({ defaultThreshold: 0.9 });
    const prompt = 'What is the capital of France?';
    const response = 'The capital of France is Paris.';
    const emb1 = [0.99, 0.1, 0.05];

    await cache.set(prompt, response, emb1);

    // Highly similar query embedding
    const queryEmbSimilar = [0.98, 0.12, 0.04];
    const result = await cache.get('Tell me the capital of France', queryEmbSimilar);

    expect(result).not.toBeNull();
    expect(result?.entry.response).toBe(response);
    expect(result?.similarity).toBeGreaterThan(0.95);
    expect(result?.entry.hits).toBe(1);

    // Dissimilar query embedding
    const queryEmbDifferent = [0.0, 0.99, 0.1];
    const resultMiss = await cache.get('Explain quantum entanglement', queryEmbDifferent);
    expect(resultMiss).toBeNull();
  });

  it('generates valid pgvector schema with HNSW index', () => {
    const cache = new PgVectorSemanticCache({ tableName: 'custom_cache', dimensions: 768 });
    const schema = cache.generatePgVectorSchema();

    expect(schema).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS custom_cache');
    expect(schema).toContain('embedding vector(768)');
    expect(schema).toContain('USING hnsw (embedding vector_cosine_ops)');
  });

  it('builds pgvector cosine distance search queries', () => {
    const cache = new PgVectorSemanticCache({ tableName: 'llm_cache' });
    const { sql, params } = cache.buildPgVectorQuery([0.1, 0.2, 0.3], 0.95, 3);

    expect(sql).toContain('1 - (embedding <=> $1::vector) AS similarity');
    expect(sql).toContain('ORDER BY embedding <=> $1::vector');
    expect(params[0]).toBe('[0.1,0.2,0.3]');
    expect(params[1]).toBe(0.95);
    expect(params[3]).toBe(3);
  });
});
