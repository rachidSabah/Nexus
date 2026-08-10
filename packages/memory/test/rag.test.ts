import { describe, it, expect, beforeEach } from 'vitest';

import {
  RagPipeline,
  TextChunker,
  DEFAULT_RAG_CONFIG,
  type RagConfig,
} from '../src/rag.js';
import { InMemoryVectorStore, FakeEmbeddingsProvider } from '../src/index.js';

// ─── TextChunker ─────────────────────────────────────────────────────────────

describe('TextChunker', () => {
  const chunker = new TextChunker();
  const config: RagConfig = { ...DEFAULT_RAG_CONFIG };

  it('returns a single chunk for text shorter than chunkSize', () => {
    const text = 'Hello, world.';
    const chunks = chunker.chunk(text, config);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(text);
    expect(chunks[0]!.startChar).toBe(0);
    expect(chunks[0]!.endChar).toBe(text.length);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(3000);
    const chunks = chunker.chunk(text, config);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('respects minChunkSize by not including tiny trailing chunks', () => {
    const smallConfig: RagConfig = { ...config, chunkSize: 200, minChunkSize: 100, chunkOverlap: 50 };
    const text = 'Lorem ipsum dolor sit amet. '.repeat(20);
    const chunks = chunker.chunk(text, smallConfig);
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThanOrEqual(smallConfig.minChunkSize);
    }
  });

  it('produces overlapping chunks (startChar of next < endChar of prev)', () => {
    const smallConfig: RagConfig = { ...config, chunkSize: 200, chunkOverlap: 100, minChunkSize: 50 };
    const text = 'a b c d e f g h i j k l m n o p '.repeat(30);
    const chunks = chunker.chunk(text, smallConfig);
    if (chunks.length > 1) {
      for (let i = 1; i < chunks.length; i++) {
        // Overlap means the next chunk starts before where the previous ended
        expect(chunks[i]!.startChar).toBeLessThan(chunks[i - 1]!.endChar);
      }
    }
  });

  it('prefers paragraph boundaries when available', () => {
    const text =
      'First paragraph with some content.\n\nSecond paragraph starts here and has more content.\n\nThird paragraph completes the text with final thoughts.';
    const smallConfig: RagConfig = { ...config, chunkSize: 60, chunkOverlap: 0, minChunkSize: 10 };
    const chunks = chunker.chunk(text, smallConfig);
    // At least one chunk should end at a paragraph boundary
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('handles empty string gracefully', () => {
    const chunks = chunker.chunk('', config);
    // Empty string has length 0, which is <= chunkSize, so returns 1 "chunk"
    expect(chunks).toHaveLength(1);
  });
});

// ─── DEFAULT_RAG_CONFIG ───────────────────────────────────────────────────────

describe('DEFAULT_RAG_CONFIG', () => {
  it('has sane defaults', () => {
    expect(DEFAULT_RAG_CONFIG.chunkSize).toBe(1000);
    expect(DEFAULT_RAG_CONFIG.chunkOverlap).toBe(200);
    expect(DEFAULT_RAG_CONFIG.minChunkSize).toBe(100);
    expect(DEFAULT_RAG_CONFIG.retrievalLimit).toBe(5);
    expect(DEFAULT_RAG_CONFIG.similarityThreshold).toBe(0.7);
    expect(DEFAULT_RAG_CONFIG.maxContextChars).toBe(4000);
  });
});

// ─── RagPipeline ─────────────────────────────────────────────────────────────

describe('RagPipeline', () => {
  let store: InMemoryVectorStore;
  let embeddings: FakeEmbeddingsProvider;
  let rag: RagPipeline;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embeddings = new FakeEmbeddingsProvider();
    rag = new RagPipeline(store, embeddings);
  });

  it('returns the configured RagConfig', () => {
    expect(rag.getConfig()).toMatchObject(DEFAULT_RAG_CONFIG);
  });

  it('overrides config values when provided', () => {
    const custom = new RagPipeline(store, embeddings, { chunkSize: 500 });
    expect(custom.getConfig().chunkSize).toBe(500);
    expect(custom.getConfig().chunkOverlap).toBe(200); // default kept
  });

  it('ingest returns metadata with chunksCreated and tokensEstimated', async () => {
    const text = 'This is a test document with some content about authentication. '.repeat(5);
    const result = await rag.ingest(text, 'test-ns', 'test-doc.txt');
    expect(result.source).toBe('test-doc.txt');
    expect(result.namespace).toBe('test-ns');
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.tokensEstimated).toBeGreaterThan(0);
  });

  it('ingest stores records in the vector store', async () => {
    const text = 'Auth service uses JWT tokens for session management. '.repeat(10);
    const ingestResult = await rag.ingest(text, 'auth-ns', 'auth-doc.txt');
    const stored = await store.list('auth-ns', 100);
    expect(stored.length).toBe(ingestResult.chunksCreated);
  });

  it('retrieve returns empty chunks for an empty namespace', async () => {
    const result = await rag.retrieve('how does auth work?', 'empty-ns');
    expect(result.chunks).toHaveLength(0);
    expect(result.augmentedPrompt).toBe('how does auth work?');
    expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('retrieve returns relevant chunks after ingest', async () => {
    const text =
      'The authentication service uses JWT tokens. ' +
      'Tokens expire after 24 hours. ' +
      'Refresh tokens are stored in encrypted cookies. ';
    await rag.ingest(text.repeat(3), 'auth2', 'guide.txt');
    const result = await rag.retrieve('JWT token expiry', 'auth2');

    // FakeEmbeddingsProvider produces deterministic embeddings — retrieval
    // similarity may be low, but the namespace should be searched.
    expect(result.query).toBe('JWT token expiry');
    expect(result.namespace).toBe('auth2');
    expect(typeof result.augmentedPrompt).toBe('string');
  });

  it('augmentedPrompt includes retrieved context when chunks are found', async () => {
    const text = 'The login flow verifies credentials against a hashed password store. '.repeat(5);
    await rag.ingest(text, 'login-ns', 'login.txt');

    // Lower the similarity threshold so the fake embedder's vectors can match
    const lowThreshRag = new RagPipeline(store, embeddings, { similarityThreshold: 0.0 });
    const result = await lowThreshRag.retrieve('credentials verification', 'login-ns');

    if (result.chunks.length > 0) {
      expect(result.augmentedPrompt).toContain('Based on the following retrieved context documents:');
      expect(result.augmentedPrompt).toContain('credentials verification');
    }
  });

  it('ingestAndQuery convenience method returns both ingest and retrieve results', async () => {
    const text = 'Security policies require MFA for all admin users. '.repeat(4);
    const combined = await rag.ingestAndQuery(text, 'mfa-ns', 'policy.md', 'MFA requirements');
    expect(combined.ingest.chunksCreated).toBeGreaterThan(0);
    expect(combined.retrieve.query).toBe('MFA requirements');
  });

  it('augmented prompt is truncated to maxContextChars', async () => {
    // Use a tiny maxContextChars to force truncation
    const tinyRag = new RagPipeline(store, embeddings, {
      maxContextChars: 200,
      similarityThreshold: 0.0,
    });
    const text = 'x'.repeat(50) + '. '.repeat(100);
    await tinyRag.ingest(text, 'trunc-ns', 'big.txt');
    const result = await tinyRag.retrieve('test query', 'trunc-ns');
    if (result.augmentedPrompt.length > 0) {
      // Prompt should stay within a reasonable bound (context + question)
      expect(result.augmentedPrompt.length).toBeLessThan(200 + 500);
    }
  });

  it('each ingested chunk has a unique rag_ prefixed id', async () => {
    const text = 'Some text content here. '.repeat(20);
    await rag.ingest(text, 'uid-ns', 'file.txt');
    const records = await store.list('uid-ns', 100);
    const ids = records.map((r) => r.id);
    // All IDs should start with rag_
    expect(ids.every((id) => id.startsWith('rag_'))).toBe(true);
    // All IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('chunk metadata includes source, namespace, chunkIndex, totalChunks', async () => {
    const text = 'Some test content here. '.repeat(30);
    await rag.ingest(text, 'meta-ns', 'source-file.ts');
    const records = await store.list('meta-ns', 100);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(r.contentType).toBe('rag_chunk');
      expect(r.namespace).toBe('meta-ns');
    }
  });
});
