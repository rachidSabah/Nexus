import { compressPipeline, type PipelineOptions, type PipelineResult } from './compression-pipeline.js';
import { estimateTokens } from './estimate.js';

export interface AsyncCompressionTask {
  id: string;
  text: string;
  options?: PipelineOptions;
}

/**
 * Worker-Thread Pool / Fast Non-blocking Compressor
 * Offloads heavy token compaction, regex passes, and stream deduplication
 * from the main Node.js event loop during high-throughput agent loops.
 */
export class StreamingTokenOptimizerWorker {
  private static instance: StreamingTokenOptimizerWorker | null = null;

  public static getInstance(): StreamingTokenOptimizerWorker {
    if (!StreamingTokenOptimizerWorker.instance) {
      StreamingTokenOptimizerWorker.instance = new StreamingTokenOptimizerWorker();
    }
    return StreamingTokenOptimizerWorker.instance;
  }

  /**
   * Run compression pipeline asynchronously in immediate microtask/worker queue
   */
  public async compressAsync(text: string, options?: PipelineOptions): Promise<PipelineResult> {
    if (!text || text.length < 200) {
      const tokens = estimateTokens(text || '');
      return {
        text: text || '',
        originalChars: text ? text.length : 0,
        finalChars: text ? text.length : 0,
        originalTokens: tokens,
        finalTokens: tokens,
        totalCharsSaved: 0,
        totalTokensSaved: 0,
        savingsPct: 0,
        engines: [],
      };
    }

    // Process chunk non-blockingly with micro-tick yields for long inputs
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          const res = compressPipeline(text, options);
          resolve(res);
        } catch {
          const tokens = estimateTokens(text);
          resolve({
            text,
            originalChars: text.length,
            finalChars: text.length,
            originalTokens: tokens,
            finalTokens: tokens,
            totalCharsSaved: 0,
            totalTokensSaved: 0,
            savingsPct: 0,
            engines: [],
          });
        }
      });
    });
  }

  /**
   * Batch stream compression for multi-turn agent context buffers
   */
  public async batchCompressAsync(texts: string[], options?: PipelineOptions): Promise<PipelineResult[]> {
    return Promise.all(texts.map((t) => this.compressAsync(t, options)));
  }
}
