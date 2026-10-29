/**
 * CredentialValidator — proactive credential validation for upstream providers.
 *
 * Inspired by free-claude-code's credential validation:
 * - Proactive validation for 20+ providers (not just reactive on 401/403)
 * - Three-status outcomes: VERIFIED, REJECTED (only on 401/498), UNVERIFIED
 * - Bounded concurrency (8), 5s timeouts per probe
 * - Custom header handling per provider
 */

import type { ProviderEndpoint } from '../domain/types.js';
import type { ProviderAdapter } from './ports.js';
import type { ModelDescriptor } from '../domain/types.js';

export type CredentialStatus = 'verified' | 'rejected' | 'unverified';

export interface CredentialValidationResult {
  providerId: string;
  keyId: string;
  status: CredentialStatus;
  error?: string;
  models?: ModelDescriptor[];
  latencyMs: number;
  validatedAt: number;
}

export interface CredentialValidatorOptions {
  /** Max concurrent validations. Default: 8 */
  maxConcurrency?: number;
  /** Timeout per validation in ms. Default: 5000 */
  probeTimeoutMs?: number;
  /** Custom validation headers per provider */
  customHeaders?: Record<string, Record<string, string>>;
  /** Providers to skip (e.g., keyless providers) */
  skipProviders?: string[];
}

/**
 * Provider-specific validation configuration
 */
interface ProviderValidationConfig {
  /** Path for validation request (e.g., '/v1/models', '/v1/chat/completions') */
  validationPath: string;
  /** HTTP method */
  method: 'GET' | 'POST';
  /** Headers to add */
  headers: Record<string, string>;
  /** Expected success status codes */
  successCodes: number[];
  /** Status codes that indicate invalid credential (REJECTED) */
  rejectCodes: number[];
  /** Body for POST requests */
  body?: unknown;
}

/** Default validation configs for known providers */
const PROVIDER_VALIDATION_CONFIGS: Record<string, ProviderValidationConfig> = {
  openai: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  anthropic: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'x-api-key': '{{KEY}}', 'anthropic-version': '2023-06-01' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  google: {
    validationPath: '/v1beta/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  openrouter: {
    validationPath: '/api/v1/auth/key',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403, 498],
  },
  groq: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  together: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  perplexity: {
    validationPath: '/chat/completions',
    method: 'POST',
    headers: { 'Authorization': 'Bearer {{KEY}}', 'Content-Type': 'application/json' },
    successCodes: [200],
    rejectCodes: [401, 403],
    body: { model: 'sonar', messages: [{ role: 'user', content: 'test' }], max_tokens: 1 },
  },
  cohere: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  mistral: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  deepseek: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  fireworks: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  replicate: {
    validationPath: '/account',
    method: 'GET',
    headers: { 'Authorization': 'Token {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  huggingface: {
    validationPath: '/api/whoami-v2',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  xai: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  cerebras: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  sambanova: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  groqcloud: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
  nvidia: {
    validationPath: '/v1/models',
    method: 'GET',
    headers: { 'Authorization': 'Bearer {{KEY}}' },
    successCodes: [200],
    rejectCodes: [401, 403],
  },
};

/**
 * CredentialValidator performs proactive validation of provider API keys.
 */
export class CredentialValidator {
  private readonly maxConcurrency: number;
  private readonly probeTimeoutMs: number;
  private readonly customHeaders: Record<string, Record<string, string>>;
  private readonly skipProviders: Set<string>;
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(opts: CredentialValidatorOptions = {}) {
    this.maxConcurrency = opts.maxConcurrency ?? 8;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 5000;
    this.customHeaders = opts.customHeaders ?? {};
    this.skipProviders = new Set(opts.skipProviders ?? []);
  }

  /**
   * Validate a single credential for a provider.
   * Returns VERIFIED, REJECTED, or UNVERIFIED.
   */
  async validate(
    providerId: string,
    keyId: string,
    endpoint: ProviderEndpoint,
    _adapter: ProviderAdapter,
    plaintextKey: string
  ): Promise<CredentialValidationResult> {
    const startedAt = Date.now();

    // Check if provider should be skipped (e.g., keyless)
    if (this.skipProviders.has(providerId)) {
      return {
        providerId,
        keyId,
        status: 'verified', // Keyless providers are implicitly verified
        latencyMs: Date.now() - startedAt,
        validatedAt: Date.now(),
      };
    }

    // Get validation config for this provider
    const config = this.getValidationConfig(providerId, endpoint, plaintextKey);

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.probeTimeoutMs);

      const response = await this.makeValidationRequest(
        endpoint,
        config,
        controller.signal
      );

      clearTimeout(timeoutId);

      if (config.successCodes.includes(response.status)) {
        // Try to parse models if available
        let models: ModelDescriptor[] | undefined;
        try {
          const data = await response.json();
          models = this.parseModelsResponse(providerId, data);
        } catch {
          // Ignore parse errors - validation succeeded even if models not parsed
        }

        return {
          providerId,
          keyId,
          status: 'verified',
          models,
          latencyMs: Date.now() - startedAt,
          validatedAt: Date.now(),
        };
      }

      if (config.rejectCodes.includes(response.status)) {
        return {
          providerId,
          keyId,
          status: 'rejected',
          error: `HTTP ${response.status}: Invalid credential`,
          latencyMs: Date.now() - startedAt,
          validatedAt: Date.now(),
        };
      }

      // Other status codes = unverified (could be transient)
      return {
        providerId,
        keyId,
        status: 'unverified',
        error: `HTTP ${response.status}: Unexpected response`,
        latencyMs: Date.now() - startedAt,
        validatedAt: Date.now(),
      };
    } catch (error) {
      // Network error, timeout, or abort = unverified (not rejected)
      return {
        providerId,
        keyId,
        status: 'unverified',
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
        validatedAt: Date.now(),
      };
    }
  }

  /**
   * Validate multiple credentials with bounded concurrency.
   */
  async validateAll(
    validations: Array<{
      providerId: string;
      keyId: string;
      endpoint: ProviderEndpoint;
      adapter: ProviderAdapter;
      plaintextKey: string;
    }>
  ): Promise<CredentialValidationResult[]> {
    const results: CredentialValidationResult[] = [];

    for (const validation of validations) {
      await this.acquireSlot();
      this.running++;

      const promise = this.validate(
        validation.providerId,
        validation.keyId,
        validation.endpoint,
        validation.adapter,
        validation.plaintextKey
      ).finally(() => {
        this.running--;
        this.processQueue();
      });

      results.push(await promise);
    }

    // Wait for any remaining
    while (this.running > 0) {
      await new Promise(r => setTimeout(r, 50));
    }

    return results;
  }

  /**
   * Get validation config for a provider, with custom headers override.
   */
  private getValidationConfig(providerId: string, _endpoint: ProviderEndpoint, key: string): ProviderValidationConfig {
    const baseConfig = PROVIDER_VALIDATION_CONFIGS[providerId] ?? {
      validationPath: '/v1/models',
      method: 'GET' as const,
      headers: { 'Authorization': 'Bearer {{KEY}}' },
      successCodes: [200],
      rejectCodes: [401, 403],
    };

    // Apply custom headers override
    const customHeaders = this.customHeaders[providerId] ?? {};

    // Interpolate key into headers
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(baseConfig.headers)) {
      headers[name] = value.replace('{{KEY}}', key);
    }
    for (const [name, value] of Object.entries(customHeaders)) {
      headers[name] = value.replace('{{KEY}}', key);
    }

    return {
      ...baseConfig,
      headers,
      validationPath: customHeaders.validationPath ?? baseConfig.validationPath,
    };
  }

  /**
   * Make the validation HTTP request.
   */
  private async makeValidationRequest(
    endpoint: ProviderEndpoint,
    config: ProviderValidationConfig,
    signal: AbortSignal
  ): Promise<Response> {
    const url = `${endpoint.baseUrl.replace(/\/$/, '')}${config.validationPath}`;

    const requestInit: RequestInit = {
      method: config.method,
      headers: config.headers,
      signal,
    };

    if (config.body && config.method === 'POST') {
      requestInit.body = JSON.stringify(config.body);
    }

    // Use the adapter's network if available, otherwise global fetch
    // For now, use global fetch
    return fetch(url, requestInit);
  }

  /**
   * Parse models from provider response.
   */
  private parseModelsResponse(providerId: string, data: unknown): ModelDescriptor[] | undefined {
    try {
      // OpenAI-style: { data: [{ id, owned_by, ... }] }
      if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as Record<string, unknown>).data)) {
        return ((data as { data: Array<Record<string, unknown>> }).data).map(m => ({
          id: String(m.id),
          providerId,
          displayName: String(m.id),
          capabilities: {},
          pricing: undefined,
          contextWindow: undefined,
          discoveredAt: Date.now(),
        }));
      }

      // Anthropic-style: { data: [{ id, type, ... }] }
      if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as Record<string, unknown>).data)) {
        return ((data as { data: Array<Record<string, unknown>> }).data).map(m => ({
          id: String(m.id),
          providerId,
          displayName: String(m.id),
          capabilities: {},
          pricing: undefined,
          contextWindow: undefined,
          discoveredAt: Date.now(),
        }));
      }

      // Generic array response
      if (Array.isArray(data)) {
        return data.map((m: unknown) => {
          const obj = m as Record<string, unknown>;
          return {
            id: String(obj.id ?? obj.model ?? obj.name ?? 'unknown'),
            providerId,
            displayName: String(obj.id ?? obj.model ?? obj.name ?? 'unknown'),
            capabilities: {},
            pricing: undefined,
            contextWindow: undefined,
            discoveredAt: Date.now(),
          };
        });
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Acquire a concurrency slot.
   */
  private acquireSlot(): Promise<void> {
    if (this.running < this.maxConcurrency) return Promise.resolve();

    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  /**
   * Process the queue when a slot frees up.
   */
  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const resolve = this.queue.shift()!;
      resolve();
    }
  }
}

/**
 * Create a CredentialValidator with default options matching free-claude-code
 */
export function createCredentialValidator(opts?: CredentialValidatorOptions): CredentialValidator {
  return new CredentialValidator({
    maxConcurrency: 8,
    probeTimeoutMs: 5000,
    ...opts,
  });
}

/**
 * Default validator instance for the application (can be overridden in tests)
 */
let globalCredentialValidator: CredentialValidator | null = null;

export function getCredentialValidator(opts?: CredentialValidatorOptions): CredentialValidator {
  if (!globalCredentialValidator) {
    globalCredentialValidator = createCredentialValidator(opts);
  }
  return globalCredentialValidator;
}

export function setCredentialValidator(validator: CredentialValidator): void {
  globalCredentialValidator = validator;
}