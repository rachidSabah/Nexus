/**
 * @anx/token-efficiency
 *
 * Token-efficiency layer for coding agents (§15–§36 of the gateway spec).
 * Shipped tier: SAFE (exact-duplicate removal) with honest no-op fallbacks
 * for BALANCED/AGGRESSIVE. Metrics are real measurements of the transform.
 */

export { TokenOptimizer, contentHash } from './optimizer.js';
export { estimateTokens, canonicalizeContent, stableKey } from './estimate.js';
export { applyBudget, groupUnits, type BudgetOptions } from './budget.js';
export { compactText, compactConversation, type CompactionOptions, type CompactionResult, type ConversationCompactionResult } from './compaction.js';
export { compressToolOutput, compressMessageContent } from './tool-output.js';
export type { ToolCompressionResult, ToolCompressionOptions } from './tool-output.js';
export {
  compressPipeline,
  type CompressionEngineName,
  type EngineBreakdown,
  type PipelineOptions,
  type PipelineResult,
} from './compression-pipeline.js';
export {
  scanRepository,
  rankRepository,
  selectRepositoryContext,
  parseGitPorcelain,
  type RepoScanResult,
  type RepoFileInfo,
  type RankedFile,
  type RepoSelection,
} from './repo-index.js';
export { ExternalCompressorRegistry, externalCompressors, type ExternalCompressorHandle } from './external-compressor.js';
export { createCavemanCompressor, type CavemanCompressorOptions, type CavemanMode } from './caveman-adapter.js';
export { OptimizationMode } from './types.js';
export type {
  OptMessage,
  OptimizationCategory,
  OptimizationResult,
  OptimizationStats,
  CategoryStats,
  TokenBudgetResult,
} from './types.js';