/**
 * ───────────────────────────────────────────────────────────────────────────
 * RAG (Retrieval-Augmented Generation) Pipeline.
 *
 * Implements the full RAG flow:
 *   1. Chunk: split text into semantically meaningful chunks
 *   2. Embed: generate vector embeddings for each chunk
 *   3. Store: persist chunks + embeddings to a vector store
 *   4. Retrieve: find the most relevant chunks for a query
 *   5. Augment: construct a prompt that includes retrieved context
 *
 * Uses the existing @anx/memory package's VectorStorePort + EmbeddingsProvider.
 * No new dependencies — everything builds on what's already there.
 *
 * Usage:
 *   const rag = new RagPipeline(vectorStore, embeddingsProvider);
 *   await rag.ingest("path/to/file.txt", "my-project");
 *   const context = await rag.retrieve("How does auth work?", "my-project");
 *   // context = "Based on the following documents:\n\n[chunk1]\n\n[chunk2]..."
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { VectorStorePort, EmbeddingsProvider, MemoryRecord } from './index.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface RagChunk {
  readonly id: string;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly metadata: {
    readonly source: string;
    readonly namespace: string;
    readonly chunkIndex: number;
    readonly totalChunks: number;
    readonly startChar: number;
    readonly endChar: number;
  };
}

export interface RagConfig {
  /** Target chunk size in characters. Default: 1000 (~250 tokens). */
  chunkSize: number;
  /** Overlap between chunks in characters. Default: 200. */
  chunkOverlap: number;
  /** Min chunk size — shorter chunks are merged. Default: 100. */
  minChunkSize: number;
  /** Number of chunks to retrieve per query. Default: 5. */
  retrievalLimit: number;
  /** Similarity threshold (0..1). Default: 0.7. */
  similarityThreshold: number;
  /** Max context characters to include in the augmented prompt. Default: 4000. */
  maxContextChars: number;
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  minChunkSize: 100,
  retrievalLimit: 5,
  similarityThreshold: 0.7,
  maxContextChars: 4000,
};

export interface RagIngestResult {
  readonly source: string;
  readonly namespace: string;
  readonly chunksCreated: number;
  readonly tokensEstimated: number;
}

export interface RagRetrieveResult {
  readonly query: string;
  readonly namespace: string;
  readonly chunks: RagChunk[];
  readonly augmentedPrompt: string;
  readonly retrievalTimeMs: number;
}

// ─── Chunker ────────────────────────────────────────────────────────────

/**
 * Splits text into semantically meaningful chunks.
 * Tries to break on paragraph boundaries, then sentence boundaries,
 * then word boundaries. Falls back to character-based splitting.
 */
export class TextChunker {
  chunk(text: string, config: RagConfig): Array<{ content: string; startChar: number; endChar: number }> {
    if (text.length <= config.chunkSize) {
      return [{ content: text, startChar: 0, endChar: text.length }];
    }

    const chunks: Array<{ content: string; startChar: number; endChar: number }> = [];
    let pos = 0;

    while (pos < text.length) {
      const end = Math.min(pos + config.chunkSize, text.length);

      // Try to find a paragraph boundary (\n\n) within the last 20% of the chunk
      const searchStart = pos + Math.floor(config.chunkSize * 0.8);
      const paraBreak = text.indexOf('\n\n', searchStart);
      let chunkEnd = end;

      if (paraBreak !== -1 && paraBreak < end + 200) {
        chunkEnd = paraBreak + 2;
      } else {
        // Try sentence boundary (. )
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > searchStart) {
          chunkEnd = sentenceBreak + 2;
        } else {
          // Try word boundary (space)
          const wordBreak = text.lastIndexOf(' ', end);
          if (wordBreak > searchStart) {
            chunkEnd = wordBreak + 1;
          }
        }
      }

      const content = text.slice(pos, chunkEnd).trim();

      // Only add if chunk is large enough
      if (content.length >= config.minChunkSize) {
        chunks.push({ content, startChar: pos, endChar: chunkEnd });
      }

      // Move position with overlap
      const nextPos = chunkEnd - config.chunkOverlap;
      pos = nextPos > pos ? nextPos : chunkEnd;
      if (pos >= text.length) break;
    }

    return chunks;
  }
}

// ─── RAG Pipeline ───────────────────────────────────────────────────────

export class RagPipeline {
  private readonly vectorStore: VectorStorePort;
  private readonly embeddingsProvider: EmbeddingsProvider;
  private readonly config: RagConfig;
  private readonly chunker: TextChunker;

  constructor(
    vectorStore: VectorStorePort,
    embeddingsProvider: EmbeddingsProvider,
    config: Partial<RagConfig> = {},
  ) {
    this.vectorStore = vectorStore;
    this.embeddingsProvider = embeddingsProvider;
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
    this.chunker = new TextChunker();
  }

  /**
   * Ingests a text document into the RAG pipeline.
   * Chunks the text → embeds each chunk → stores in the vector store.
   */
  async ingest(
    text: string,
    namespace: string,
    source: string,
  ): Promise<RagIngestResult> {
    // 1. Chunk
    const rawChunks = this.chunker.chunk(text, this.config);

    // 2. Embed all chunks in a batch (if supported)
    const texts = rawChunks.map((c) => c.content);
    const embeddings = await this.embedBatch(texts);

    // 3. Store each chunk as a MemoryRecord with embedding
    let tokensEstimated = 0;
    for (let i = 0; i < rawChunks.length; i++) {
      const chunk = rawChunks[i]!;
      const embedding = embeddings[i]!;

      const record: MemoryRecord = {
        id: `rag_${namespace}_${randomUUID()}`,
        namespace,
        scope: 'long',
        contentType: 'rag_chunk',
        content: chunk.content,
        embedding,
        metadata: {
          source,
          namespace,
          chunkIndex: i,
          totalChunks: rawChunks.length,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        } as unknown as Record<string, unknown>,
        createdAt: new Date(),
        tokenCount: Math.ceil(chunk.content.length / 4),
      };

      await this.vectorStore.upsert(record);
      tokensEstimated += record.tokenCount;
    }

    return {
      source,
      namespace,
      chunksCreated: rawChunks.length,
      tokensEstimated,
    };
  }

  /**
   * Retrieves the most relevant chunks for a query and constructs
   * an augmented prompt with the retrieved context.
   */
  async retrieve(
    query: string,
    namespace: string,
  ): Promise<RagRetrieveResult> {
    const startTime = Date.now();

    // 1. Embed the query
    const queryEmbedding = await this.embeddingsProvider.embed(query);

    // 2. Search the vector store for similar chunks
    const results = await this.vectorStore.search(queryEmbedding, {
      namespace,
      limit: this.config.retrievalLimit,
      threshold: this.config.similarityThreshold,
    });

    // 3. Convert results to RagChunks
    const chunks: RagChunk[] = results.map((r) => ({
      id: r.record.id,
      content: r.record.content,
      embedding: r.record.embedding ?? [],
      metadata: r.record.metadata as unknown as RagChunk['metadata'],
    }));

    // 4. Build the augmented prompt
    const augmentedPrompt = this.buildAugmentedPrompt(query, chunks);

    return {
      query,
      namespace,
      chunks,
      augmentedPrompt,
      retrievalTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Convenience method: ingest a document and immediately test retrieval.
   */
  async ingestAndQuery(
    text: string,
    namespace: string,
    source: string,
    query: string,
  ): Promise<{ ingest: RagIngestResult; retrieve: RagRetrieveResult }> {
    const ingest = await this.ingest(text, namespace, source);
    const retrieve = await this.retrieve(query, namespace);
    return { ingest, retrieve };
  }

  /** Returns the current config. */
  getConfig(): RagConfig { return this.config; }

  // ─── Internal ────────────────────────────────────────────────────────

  private buildAugmentedPrompt(query: string, chunks: RagChunk[]): string {
    if (chunks.length === 0) {
      return query;
    }

    let context = '';
    let totalChars = 0;

    for (const chunk of chunks) {
      const chunkText = `[Source: ${chunk.metadata.source}, Chunk: ${chunk.metadata.chunkIndex + 1}/${chunk.metadata.totalChunks}]\n${chunk.content}\n\n`;
      if (totalChars + chunkText.length > this.config.maxContextChars) {
        // Truncate to fit
        const remaining = this.config.maxContextChars - totalChars;
        if (remaining > 100) {
          context += chunkText.slice(0, remaining) + '...\n\n';
        }
        break;
      }
      context += chunkText;
      totalChars += chunkText.length;
    }

    return `Based on the following retrieved context documents:

${context}
---

Using only the information from the context above, answer the following question. If the context does not contain enough information, say so.

Question: ${query}`;
  }

  private async embedBatch(texts: string[]): Promise<readonly (readonly number[])[]> {
    // Use batch embedding if the provider supports it
    if ('embedBatch' in this.embeddingsProvider && typeof (this.embeddingsProvider as { embedBatch?: unknown }).embedBatch === 'function') {
      return (this.embeddingsProvider as { embedBatch: (texts: string[]) => Promise<readonly (readonly number[])[]> }).embedBatch(texts);
    }
    // Fallback: embed one at a time
    const results: number[][] = [];
    for (const text of texts) {
      results.push([...await this.embeddingsProvider.embed(text)]);
    }
    return results;
  }
}
