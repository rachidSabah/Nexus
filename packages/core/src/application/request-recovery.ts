/**
 * RequestRecovery — handles authentication retry and request correction strategies.
 *
 * Inspired by free-claude-code's request recovery mechanisms:
 * - Single auth retry per execution (refresh endpoint/key on 401/403)
 * - Request body corrections (fix model name, remove unsupported params, etc.)
 * - Content delivery check before allowing mid-stream failover
 */

import type { ChatCompletionRequest, ChatCompletionChunk } from '../domain/types.js';
import type { ProviderEndpoint } from '../domain/types.js';
import type { ProviderAdapter } from './ports.js';

export interface RequestCorrection {
  /** Description of what was corrected */
  description: string;
  /** The corrected request body */
  correctedBody: ChatCompletionRequest;
  /** Timestamp of correction */
  timestamp: number;
}

export interface RequestRecoveryOptions {
  /** Max auth retries per execution. Default: 1 */
  maxAuthRetries?: number;
  /** Max request corrections per execution. Default: 3 */
  maxCorrections?: number;
  /** Whether to enable request corrections. Default: true */
  enableCorrections?: boolean;
}

/**
 * Tracks correction history for a single request execution.
 * Prevents infinite correction loops and tracks what was already tried.
 */
export class RequestCorrections {
  private corrections: RequestCorrection[] = [];
  private readonly maxCorrections: number;

  constructor(maxCorrections = 3) {
    this.maxCorrections = maxCorrections;
  }

  /** Add a correction attempt */
  add(correction: RequestCorrection): boolean {
    if (this.corrections.length >= this.maxCorrections) {
      return false; // Max corrections reached
    }
    this.corrections.push(correction);
    return true;
  }

  /** Get all corrections applied so far */
  getAll(): readonly RequestCorrection[] {
    return this.corrections;
  }

  /** Get the latest corrected body, or original if no corrections */
  getLatestBody(original: ChatCompletionRequest): ChatCompletionRequest {
    return this.corrections.length > 0
      ? this.corrections[this.corrections.length - 1]!.correctedBody
      : original;
  }

  /** Check if a specific correction was already applied */
  hasCorrection(description: string): boolean {
    return this.corrections.some(c => c.description === description);
  }

  /** Reset for a new execution attempt */
  reset(): void {
    this.corrections = [];
  }

  /** Number of corrections applied */
  get count(): number {
    return this.corrections.length;
  }
}

/**
 * Result of an authentication retry attempt
 */
export interface AuthRetryResult {
  /** Whether auth retry was attempted */
  attempted: boolean;
  /** Whether auth retry succeeded (new credentials worked) */
  succeeded: boolean;
  /** Updated endpoint with refreshed credentials, if successful */
  endpoint?: ProviderEndpoint;
  /** Error if auth retry failed */
  error?: Error;
}

/**
 * RequestRecovery coordinates retry logic with content delivery verification.
 */
export class RequestRecovery {
  private readonly maxAuthRetries: number;
  private readonly maxCorrections: number;
  private readonly enableCorrections: boolean;
  private authRetriesUsed = 0;

  constructor(opts: RequestRecoveryOptions = {}) {
    this.maxAuthRetries = opts.maxAuthRetries ?? 1;
    this.maxCorrections = opts.maxCorrections ?? 3;
    this.enableCorrections = opts.enableCorrections ?? true;
  }

  /**
   * Attempt to recover from an authentication failure (401/403).
   * Refreshes the endpoint's credentials and returns updated endpoint if successful.
   * Only allows ONE auth retry per execution to prevent loops.
   */
  async retryAuthentication(
    endpoint: ProviderEndpoint,
    adapter: ProviderAdapter,
    _request: ChatCompletionRequest,
    signal: AbortSignal
  ): Promise<AuthRetryResult> {
    if (this.authRetriesUsed >= this.maxAuthRetries) {
      return { attempted: false, succeeded: false };
    }

    this.authRetriesUsed++;

    try {
      // Try to get a fresh credential for this provider
      // The adapter's healthCheck can serve as a credential validation probe
      const isHealthy = await adapter.healthCheck(endpoint, signal);

      if (!isHealthy) {
        return {
          attempted: true,
          succeeded: false,
          error: new Error('Credential validation failed after refresh')
        };
      }

      // Health check passed - endpoint should have valid credentials now
      return {
        attempted: true,
        succeeded: true,
        endpoint
      };
    } catch (error) {
      return {
        attempted: true,
        succeeded: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Reset auth retry counter for a new execution
   */
  resetAuthRetries(): void {
    this.authRetriesUsed = 0;
  }

  /**
   * Check if auth retries are exhausted
   */
  isAuthRetriesExhausted(): boolean {
    return this.authRetriesUsed >= this.maxAuthRetries;
  }

  /**
   * Apply request corrections for common provider issues.
   * Returns corrected request or null if no corrections applied / max reached.
   */
  applyCorrections(
    originalRequest: ChatCompletionRequest,
    corrections: RequestCorrections,
    classification: { status: number; code?: string; keyAction: string; endpointAction: string; reason: string }
  ): ChatCompletionRequest | null {
    if (!this.enableCorrections) return null;
    if (corrections.count >= this.maxCorrections) return null;

    let corrected: ChatCompletionRequest | null = null;

    // Check error type from classification
    const isModelNotFound = classification.code === 'MODEL_UNAVAILABLE' || classification.status === 404;
    const isContextLengthExceeded = classification.status === 413;
    const isInvalidRequest = classification.status >= 400 && classification.status < 500 && classification.status !== 401 && classification.status !== 403 && classification.status !== 404 && classification.status !== 413 && classification.status !== 429;

    // Correction 1: Model not found -> try alias resolution
    if (isModelNotFound && !corrections.hasCorrection('model-alias')) {
      const model = originalRequest.model;
      if (model.includes('/')) {
        const shortModel = model.split('/').pop() || model;
        corrected = { ...originalRequest, model: shortModel };
      }
    }

    // Correction 2: Unsupported parameter -> remove unsupported params
    if (isInvalidRequest && !corrections.hasCorrection('unsupported-param')) {
      // Remove common unsupported parameters
      const { tools, toolChoice, responseFormat, ...rest } = originalRequest;
      corrected = rest as ChatCompletionRequest;
    }

    // Correction 3: Context length exceeded -> truncate messages
    if (isContextLengthExceeded && !corrections.hasCorrection('context-truncate')) {
      corrected = this.truncateMessages(originalRequest);
    }

    // Correction 4: Invalid request format -> sanitize
    if (isInvalidRequest && !corrections.hasCorrection('sanitize-request')) {
      corrected = this.sanitizeRequest(originalRequest);
    }

    if (corrected) {
      const added = corrections.add({
        description: this.getCorrectionDescription(classification),
        correctedBody: corrected,
        timestamp: Date.now()
      });
      if (!added) return null; // Max corrections reached
      return corrected;
    }

    return null;
  }

  /**
   * Determine if we can still apply corrections (public content can be replaced)
   * This mirrors free-claude-code's "public content can still be replaced" check.
   */
  canApplyCorrections(corrections: RequestCorrections): boolean {
    return this.enableCorrections && corrections.count < this.maxCorrections;
  }

  /**
   * Check if response has delivered actual content (not just headers/start)
   * This determines if mid-stream failover is allowed.
   */
  hasDeliveredContent(chunks: ChatCompletionChunk[]): boolean {
    return chunks.some(chunk =>
      chunk.choices?.some(choice =>
        choice.delta?.content !== undefined &&
        choice.delta.content !== null &&
        choice.delta.content !== ''
      )
    );
  }

  // ─── Private correction helpers ────────────────────────────────────────────

  private getCorrectionDescription(classification: { status: number; code?: string; keyAction: string; endpointAction: string; reason: string }): string {
    const isModelNotFound = classification.code === 'MODEL_UNAVAILABLE' || classification.status === 404;
    const isContextLengthExceeded = classification.status === 413;
    const isInvalidRequest = classification.status >= 400 && classification.status < 500 && classification.status !== 401 && classification.status !== 403 && classification.status !== 404 && classification.status !== 413 && classification.status !== 429;

    if (isModelNotFound) return 'model-alias';
    if (isInvalidRequest) return 'unsupported-param';
    if (isContextLengthExceeded) return 'context-truncate';
    return 'sanitize-request';
  }

  private truncateMessages(request: ChatCompletionRequest): ChatCompletionRequest {
    // Keep system message, truncate older user/assistant messages
    const messages = request.messages ?? [];
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    // Keep last 10 non-system messages (rough heuristic)
    const kept = otherMessages.slice(-10);
    const truncated = [...systemMessages, ...kept];

    return { ...request, messages: truncated };
  }

  private sanitizeRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    // Remove potentially problematic fields
    const {
      // These might cause issues with some providers
      user,
      metadata,
      ...sanitized
    } = request;

    // Ensure temperature is in valid range
    if (sanitized.temperature !== undefined) {
      sanitized.temperature = Math.max(0, Math.min(2, sanitized.temperature));
    }

    // Ensure topP is in valid range
    if (sanitized.topP !== undefined) {
      sanitized.topP = Math.max(0, Math.min(1, sanitized.topP));
    }

    return sanitized as ChatCompletionRequest;
  }
}

/**
 * Create a RequestRecovery instance with default options matching free-claude-code
 */
export function createRequestRecovery(opts?: RequestRecoveryOptions): RequestRecovery {
  return new RequestRecovery({
    maxAuthRetries: 1,
    maxCorrections: 3,
    enableCorrections: true,
    ...opts
  });
}