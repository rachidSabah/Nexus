/**
 * ───────────────────────────────────────────────────────────────────────────
 * Token-efficiency types — shared contracts for the optimization pipeline.
 *
 * Master spec §15–§36: the gateway must act as a token-efficiency layer
 * between coding agents and models WITHOUT degrading correctness.
 *
 * HONESTY GUARANTEE (§41): only SAFE-mode optimizations are implemented.
 * BALANCED and AGGRESSIVE currently run as identity transforms and report
 * a `notImplemented` warning in stats — they are never silently claimed
 * to be doing work.
 * ───────────────────────────────────────────────────────────────────────────
 */

/** Optimization modes per §31. Default per spec is BALANCED; shipped default is OFF until BALANCED is implemented. */
export enum OptimizationMode {
  OFF = 'off',
  SAFE = 'safe',
  BALANCED = 'balanced',
  AGGRESSIVE = 'aggressive',
}

/** Canonical message shape the optimizer operates on (gateway-normalized). */
export interface OptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** String content (chat/tool) — canonicalized by the caller; never rewritten by SAFE mode. */
  content?: unknown;
  /** Preserved verbatim; SAFE mode never adds/removes/reorders these. */
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
  tool_use_id?: string;
  [key: string]: unknown;
}

export type OptimizationCategory =
  | 'duplicate_system'
  | 'duplicate_message'
  | 'duplicate_tool_output'
  | 'context_budget'
  | 'tool_compression'
  | 'conversation_compaction';

export interface CategoryStats {
  removedBlocks: number;
  removedChars: number;
  removedTokens: number;
  tokensSaved: number;
}

export interface OptimizationStats {
  mode: OptimizationMode;
  originalBlocks: number;
  optimizedBlocks: number;
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  savingsPct: number;
  dedupHitBlocks: number;
  categories: Record<OptimizationCategory, CategoryStats>;
  /** Non-fatal notes (e.g. BALANCED/AGGRESSIVE not implemented yet). */
  warnings: string[];
}

export interface OptimizationResult {
  messages: OptMessage[];
  stats: OptimizationStats;
  /** True when the transform changed the message list. */
  changed: boolean;
}

/** Result of a context-budget trim (§25). */
export interface TokenBudgetResult {
  messages: OptMessage[];
  droppedTokens: number;
  droppedMessages: number;
  removedChars: number;
  originalTokens: number;
  retainedTokens: number;
  underBudget: boolean;
  category: 'context_budget';
}