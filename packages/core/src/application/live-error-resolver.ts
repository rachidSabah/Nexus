/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Live Provider Error Resolution Engine
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Implements the real, live 4-step remediation loop:
 *   DIAGNOSE → REMEDIATE → VERIFY → RECOVER
 *
 * Never fakes health, never simply clears counters without verification.
 */

import { maskKeyString } from '../domain/error-diagnostic.js';
import { buildEvent } from '../domain/events.js';
import type { ProviderEndpoint } from '../domain/types.js';

import type { ErrorDiagnosticRegistry } from './error-diagnostic-registry.js';
import type { KeyRegistry } from './key-registry.js';
import type { ModelRegistry } from './model-registry.js';
import type { EventBusPort, ProviderAdapter, RoutingEnginePort } from './ports.js';

export interface ResolutionStepLog {
  step: string;
  status: 'ok' | 'fail' | 'info';
  message: string;
}

export interface RemediationReport {
  readonly resolved: boolean;
  readonly providerId: string;
  readonly targetModel?: string;
  readonly targetKeyId?: string;
  readonly actionTaken: string;
  readonly steps: ResolutionStepLog[];
  readonly verification: 'passed' | 'failed' | 'skipped';
  readonly healthy: boolean;
  readonly message: string;
  readonly recommendation?: string;
  readonly latencyMs?: number;
  readonly timestamp: number;
}

export interface LiveErrorResolverDeps {
  readonly routing: RoutingEnginePort;
  readonly keyRegistry?: KeyRegistry;
  readonly modelRegistry?: ModelRegistry;
  readonly errorRegistry: ErrorDiagnosticRegistry;
  readonly adapters?: Map<string, ProviderAdapter>;
  readonly events?: EventBusPort;
  readonly modelRediscoverCallback?: (providerId?: string) => Promise<void>;
}

export class LiveErrorResolver {
  private readonly activeResolutions = new Set<string>();

  constructor(private readonly deps: LiveErrorResolverDeps) {}

  /**
   * Resolves all active errors and degraded states for a provider.
   * Full 4-step cycle: DIAGNOSE → REMEDIATE → VERIFY → RECOVER.
   */
  async resolveProvider(providerId: string): Promise<RemediationReport> {
    const lockKey = `provider:${providerId}`;
    if (this.activeResolutions.has(lockKey)) {
      return {
        resolved: false,
        providerId,
        actionTaken: 'concurrency_lock',
        steps: [{ step: 'Lock Check', status: 'info', message: 'Resolution is already in progress for this provider.' }],
        verification: 'skipped',
        healthy: false,
        message: 'Resolution already in progress.',
        timestamp: Date.now(),
      };
    }

    this.activeResolutions.add(lockKey);
    const steps: ResolutionStepLog[] = [];
    const now = Date.now();

    try {
      steps.push({ step: 'Initialize', status: 'ok', message: `Beginning live diagnostic for provider '${providerId}'...` });

      // 1. Locate Endpoint & Health
      const endpoints = this.deps.routing.listEndpoints();
      const endpoint = endpoints.find((e) => e.providerId === providerId || e.id === providerId);
      if (!endpoint) {
        steps.push({ step: 'Endpoint Lookup', status: 'fail', message: `No registered endpoint found for provider '${providerId}'.` });
        return {
          resolved: false,
          providerId,
          actionTaken: 'endpoint_not_found',
          steps,
          verification: 'failed',
          healthy: false,
          message: `No endpoint configured for provider '${providerId}'.`,
          recommendation: 'Register the provider endpoint in Nexus Gateway before resolving.',
          timestamp: Date.now(),
        };
      }

      steps.push({
        step: 'Endpoint Check',
        status: 'ok',
        message: `Endpoint '${endpoint.id}' located (${endpoint.baseUrl}). Current health: ${endpoint.health}.`,
      });

      // 2. Inspect Active Errors in Diagnostic Registry
      const activeErrors = this.deps.errorRegistry.listActive(providerId);
      steps.push({
        step: 'Error Inspection',
        status: activeErrors.length > 0 ? 'info' : 'ok',
        message: `Found ${activeErrors.length} active error diagnostic(s) recorded for '${providerId}'.`,
      });

      // Check if provider is already healthy with no active errors or degraded keys
      const keyRegistry = this.deps.keyRegistry;
      const allKeys = keyRegistry?.listByProvider(providerId) ?? [];
      const hasUnhealthyKeys = allKeys.some((k) => k.status !== 'active');
      if (endpoint.health === 'healthy' && activeErrors.length === 0 && !hasUnhealthyKeys) {
        steps.push({ step: 'Health Status', status: 'ok', message: `Provider '${providerId}' is already healthy with all keys active.` });
        const report: RemediationReport = {
          resolved: true,
          providerId,
          actionTaken: 'already_healthy',
          steps,
          verification: 'passed',
          healthy: true,
          message: 'Provider is already healthy.',
          timestamp: Date.now(),
        };
        this.logRecovery(report, 200, undefined, 0);
        return report;
      }

      let keyToTest: { id?: string; plaintext?: string } | undefined;

      if (keyRegistry) {
        const keys = keyRegistry.listByProvider(providerId);
        const activeKeys = keys.filter((k) => k.status === 'active');
        const cooldownKeys = keys.filter((k) => k.status === 'cooldown');
        const invalidKeys = keys.filter((k) => k.status === 'invalid');

        steps.push({
          step: 'Key Vault Inspection',
          status: 'ok',
          message: `Key inventory: ${keys.length} total (${activeKeys.length} active, ${cooldownKeys.length} cooldown, ${invalidKeys.length} invalid).`,
        });

        // Scenario: Cooldown / Rate-Limited keys
        if (cooldownKeys.length > 0) {
          for (const ck of cooldownKeys) {
            if (ck.cooldownUntil <= Date.now()) {
              keyRegistry.reset(ck.id);
              steps.push({ step: 'Cooldown Expiry', status: 'ok', message: `Expired cooldown for key ••••${ck.lastFour}. Restored to active.` });
            }
          }
        }

        // Scenario: 401 on some keys -> rotate to healthy active key
        if (activeKeys.length > 0) {
          const chosen = activeKeys[0]!;
          const pt = await keyRegistry.getPlaintext(chosen.id);
          if (pt) {
            keyToTest = { id: chosen.id, plaintext: pt };
            steps.push({ step: 'Key Selection', status: 'ok', message: `Selected active key ••••${chosen.lastFour} for verification.` });
          }
        } else if (cooldownKeys.length > 0) {
          const chosen = cooldownKeys[0]!;
          keyRegistry.reset(chosen.id);
          const pt = await keyRegistry.getPlaintext(chosen.id);
          if (pt) {
            keyToTest = { id: chosen.id, plaintext: pt };
            steps.push({ step: 'Key Recovery', status: 'ok', message: `Reset cooldown for key ••••${chosen.lastFour} for verification.` });
          }
        } else if (invalidKeys.length > 0) {
          // Attempt recovery probe on first invalid key (transient auth blip test)
          const chosen = invalidKeys[0]!;
          const pt = await keyRegistry.getPlaintext(chosen.id);
          if (pt) {
            keyToTest = { id: chosen.id, plaintext: pt };
            steps.push({ step: 'Key Re-evaluation', status: 'info', message: `Testing previously invalid key ••••${chosen.lastFour} to verify if credentials were renewed upstream.` });
          }
        }
      }

      // Fall back to endpoint API key if no vault key was resolved
      if (!keyToTest?.plaintext) {
        const epKey = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
        if (epKey && epKey !== '***') {
          keyToTest = { plaintext: epKey };
          steps.push({ step: 'Key Selection', status: 'ok', message: 'Using static endpoint API key for verification.' });
        }
      }

      // 4. Inspect & Remediate Model Catalog
      if (this.deps.modelRegistry) {
        const models = this.deps.modelRegistry.list().filter((m) => m.providerId === providerId);
        const unhealthyModels = models.filter((m) => m.stale);
        if (unhealthyModels.length > 0) {
          steps.push({
            step: 'Model Health Check',
            status: 'info',
            message: `${unhealthyModels.length} model(s) marked unhealthy for this provider (${unhealthyModels.map((m) => m.id).slice(0, 3).join(', ')}).`,
          });
          // Trigger rediscovery if available
          if (this.deps.modelRediscoverCallback) {
            try {
              steps.push({ step: 'Catalog Sync', status: 'info', message: 'Refreshing model catalog from provider API...' });
              await this.deps.modelRediscoverCallback(providerId);
              steps.push({ step: 'Catalog Sync', status: 'ok', message: 'Model catalog refreshed.' });
            } catch (err) {
              steps.push({ step: 'Catalog Sync', status: 'info', message: `Model rediscovery attempt: ${(err as Error).message}` });
            }
          }
        }
      }

      // 5. LIVE VERIFICATION REQUEST
      steps.push({ step: 'Live Verification', status: 'info', message: 'Executing live verification probe to upstream provider...' });
      const verifyResult = await this.executeLiveVerification(endpoint, keyToTest?.plaintext);

      if (!verifyResult.ok) {
        steps.push({
          step: 'Verification Result',
          status: 'fail',
          message: `Live upstream verification failed: ${verifyResult.error} (${verifyResult.latencyMs}ms).`,
        });

        // If the key tested failed authentication, mark it invalid honestly
        if (keyToTest?.id && keyRegistry && verifyResult.status === 401) {
          keyRegistry.recordFailure(keyToTest.id, 401, false);
          steps.push({ step: 'Key Quarantine', status: 'fail', message: `Key ${keyToTest.id} confirmed invalid (HTTP 401). Quarantined in registry.` });
        } else if (keyToTest?.id && keyRegistry && verifyResult.status === 429) {
          const cooldownDuration = verifyResult.retryAfterMs ?? 60_000;
          keyRegistry.recordFailure(keyToTest.id, 429, true, cooldownDuration);
          steps.push({
            step: 'Key Cooldown',
            status: 'info',
            message: `Key ${keyToTest.id} hit upstream rate limit (HTTP 429). Retry-After cooldown applied (${Math.ceil(cooldownDuration / 1000)}s).`,
          });
        }

        // Record diagnostic update
        for (const err of activeErrors) {
          this.deps.errorRegistry.markResolved(err.id, 'remediation_attempted', {
            verified: false,
            message: verifyResult.error ?? 'Verification failed',
            latencyMs: verifyResult.latencyMs,
          });
        }

        const report: RemediationReport = {
          resolved: false,
          providerId,
          actionTaken: 'live_verification_failed',
          steps,
          verification: 'failed',
          healthy: false,
          message: `Remediation verification failed: ${verifyResult.error}`,
          recommendation:
            verifyResult.status === 401
              ? 'Update invalid or expired API credentials in the Key Vault.'
              : verifyResult.status === 429
                ? `Provider is currently rate-limited upstream. Retry-After cooldown active (${Math.ceil((verifyResult.retryAfterMs ?? 60_000) / 1000)}s).`
                : 'Check provider endpoint reachability and network connection.',
          latencyMs: verifyResult.latencyMs,
          timestamp: Date.now(),
        };
        this.logRecovery(report, verifyResult.status, keyToTest?.plaintext ? maskKeyString(keyToTest.plaintext) : undefined, verifyResult.latencyMs);
        return report;
      }

      // 6. LIVE VERIFICATION SUCCEEDED -> RECOVER
      steps.push({
        step: 'Verification Result',
        status: 'ok',
        message: `Live verification PASSED in ${verifyResult.latencyMs}ms (Response model: ${verifyResult.model}).`,
      });

      // Update RoutingEngine endpoint health
      this.deps.routing.recordSuccess(endpoint.id, verifyResult.latencyMs);
      this.deps.routing.updateEndpoint(endpoint.id, { health: 'healthy' });
      steps.push({ step: 'Circuit Recovery', status: 'ok', message: `Circuit breaker reset: Endpoint '${endpoint.id}' marked HEALTHY.` });

      // Update KeyRegistry key health
      if (keyToTest?.id && keyRegistry) {
        keyRegistry.recordSuccess(keyToTest.id, verifyResult.latencyMs, 1);
        keyRegistry.reset(keyToTest.id);
        steps.push({ step: 'Key Recovery', status: 'ok', message: `Key ${keyToTest.id} confirmed valid and set to ACTIVE.` });
      }

      // Update ModelRegistry model health
      if (this.deps.modelRegistry && verifyResult.model) {
        this.deps.modelRegistry.markModelHealthy(providerId, verifyResult.model);
      }

      // Clear / Resolve Error Diagnostics
      this.deps.errorRegistry.recordSuccess(providerId, keyToTest?.id, verifyResult.model);
      for (const err of activeErrors) {
        this.deps.errorRegistry.markResolved(err.id, 'live_verification_recovery', {
          verified: true,
          message: `Recovered and verified live (${verifyResult.latencyMs}ms).`,
          latencyMs: verifyResult.latencyMs,
        });
      }

      // Emit recovery event
      void this.deps.events?.publish(
        buildEvent('provider.recovered' as never, {
          providerId,
          endpointId: endpoint.id,
          latencyMs: verifyResult.latencyMs,
          at: now,
        } as never),
      );

      steps.push({ step: 'Complete', status: 'ok', message: `Provider '${providerId}' is fully recovered, healthy, and ready for live routing.` });

      const report: RemediationReport = {
        resolved: true,
        providerId,
        targetModel: verifyResult.model,
        targetKeyId: keyToTest?.id,
        actionTaken: 'live_verification_recovery',
        steps,
        verification: 'passed',
        healthy: true,
        message: `Provider '${providerId}' successfully remediated and verified live (${verifyResult.latencyMs}ms).`,
        latencyMs: verifyResult.latencyMs,
        timestamp: Date.now(),
      };
      this.logRecovery(report, 200, keyToTest?.plaintext ? maskKeyString(keyToTest.plaintext) : undefined, verifyResult.latencyMs);
      return report;
    } catch (err) {
      steps.push({ step: 'Error', status: 'fail', message: `Unexpected failure during remediation: ${(err as Error).message}` });
      const report: RemediationReport = {
        resolved: false,
        providerId,
        actionTaken: 'unhandled_exception',
        steps,
        verification: 'failed',
        healthy: false,
        message: `Remediation failed: ${(err as Error).message}`,
        timestamp: Date.now(),
      };
      this.logRecovery(report, 500, undefined, 0);
      return report;
    } finally {
      this.activeResolutions.delete(lockKey);
    }
  }

  /**
   * Resolves a single API key by verifying it live against its provider endpoint.
   */
  async resolveKey(keyId: string): Promise<RemediationReport> {
    const keyRegistry = this.deps.keyRegistry;
    if (!keyRegistry) {
      return {
        resolved: false,
        providerId: 'unknown',
        targetKeyId: keyId,
        actionTaken: 'no_key_registry',
        steps: [{ step: 'Init', status: 'fail', message: 'Key registry not configured.' }],
        verification: 'failed',
        healthy: false,
        message: 'Key registry is not available.',
        timestamp: Date.now(),
      };
    }

    const key = keyRegistry.get(keyId);
    if (!key) {
      return {
        resolved: false,
        providerId: 'unknown',
        targetKeyId: keyId,
        actionTaken: 'key_not_found',
        steps: [{ step: 'Lookup', status: 'fail', message: `Key '${keyId}' not found in registry.` }],
        verification: 'failed',
        healthy: false,
        message: `Key '${keyId}' not found.`,
        timestamp: Date.now(),
      };
    }

    const steps: ResolutionStepLog[] = [
      { step: 'Init', status: 'ok', message: `Diagnosing key ••••${key.lastFour} for provider '${key.providerId}'...` },
    ];

    const endpoint = this.deps.routing.listEndpoints().find((e) => e.providerId === key.providerId);
    if (!endpoint) {
      steps.push({ step: 'Endpoint Lookup', status: 'fail', message: `No endpoint found for provider '${key.providerId}'.` });
      return {
        resolved: false,
        providerId: key.providerId,
        targetKeyId: keyId,
        actionTaken: 'no_endpoint',
        steps,
        verification: 'failed',
        healthy: false,
        message: `No endpoint found for provider '${key.providerId}'.`,
        timestamp: Date.now(),
      };
    }

    const plaintext = await keyRegistry.getPlaintext(keyId);
    if (!plaintext) {
      steps.push({ step: 'Vault Check', status: 'fail', message: 'Plaintext credential missing from encrypted vault.' });
      return {
        resolved: false,
        providerId: key.providerId,
        targetKeyId: keyId,
        actionTaken: 'vault_missing',
        steps,
        verification: 'failed',
        healthy: false,
        message: 'Credential payload missing from vault.',
        recommendation: 'Re-register this API key in Key Vault.',
        timestamp: Date.now(),
      };
    }

    steps.push({ step: 'Verification', status: 'info', message: 'Testing credential against live upstream provider...' });
    const verifyResult = await this.executeLiveVerification(endpoint, plaintext);

    if (!verifyResult.ok) {
      steps.push({
        step: 'Verification Result',
        status: 'fail',
        message: `Credential verification failed: ${verifyResult.error} (HTTP ${verifyResult.status ?? 'error'}).`,
      });
      keyRegistry.recordFailure(keyId, verifyResult.status ?? 401, false);

      const failReport: RemediationReport = {
        resolved: false,
        providerId: key.providerId,
        targetKeyId: keyId,
        actionTaken: 'key_verification_failed',
        steps,
        verification: 'failed',
        healthy: false,
        message: `Key verification failed: ${verifyResult.error}`,
        recommendation: 'Verify key validity in provider account console.',
        latencyMs: verifyResult.latencyMs,
        timestamp: Date.now(),
      };
      this.logRecovery(failReport, verifyResult.status, `••••${key.lastFour}`, verifyResult.latencyMs);
      return failReport;
    }

    // Success -> Recover Key
    keyRegistry.recordSuccess(keyId, verifyResult.latencyMs, 1);
    keyRegistry.reset(keyId);
    this.deps.errorRegistry.recordSuccess(key.providerId, keyId);

    steps.push({
      step: 'Key Recovery',
      status: 'ok',
      message: `Key ••••${key.lastFour} verified successfully in ${verifyResult.latencyMs}ms. Status set to ACTIVE.`,
    });

    const successReport: RemediationReport = {
      resolved: true,
      providerId: key.providerId,
      targetKeyId: keyId,
      actionTaken: 'key_verified_and_activated',
      steps,
      verification: 'passed',
      healthy: true,
      message: `Key ••••${key.lastFour} verified and restored to active rotation.`,
      latencyMs: verifyResult.latencyMs,
      timestamp: Date.now(),
    };
    this.logRecovery(successReport, 200, `••••${key.lastFour}`, verifyResult.latencyMs);
    return successReport;
  }

  /**
   * Resolves a model error (404/410/context) for a specific model.
   */
  async resolveModel(providerId: string, modelId: string): Promise<RemediationReport> {
    const steps: ResolutionStepLog[] = [
      { step: 'Init', status: 'ok', message: `Diagnosing model '${modelId}' on provider '${providerId}'...` },
    ];

    const endpoint = this.deps.routing.listEndpoints().find((e) => e.providerId === providerId);
    if (!endpoint) {
      return {
        resolved: false,
        providerId,
        targetModel: modelId,
        actionTaken: 'no_endpoint',
        steps: [{ step: 'Endpoint Lookup', status: 'fail', message: `Provider '${providerId}' has no active endpoint.` }],
        verification: 'failed',
        healthy: false,
        message: `Provider '${providerId}' not found.`,
        timestamp: Date.now(),
      };
    }

    // Trigger catalog sync
    if (this.deps.modelRediscoverCallback) {
      try {
        steps.push({ step: 'Catalog Refresh', status: 'info', message: 'Syncing live model catalog from provider API...' });
        await this.deps.modelRediscoverCallback(providerId);
        steps.push({ step: 'Catalog Refresh', status: 'ok', message: 'Model catalog synchronized.' });
      } catch (e) {
        steps.push({ step: 'Catalog Refresh', status: 'info', message: `Sync completed with warning: ${(e as Error).message}` });
      }
    }

    // Verify model availability with a lightweight 1-token probe
    const key = this.deps.keyRegistry?.select(providerId, { skipCooldown: true });
    const plaintext = key ? await this.deps.keyRegistry?.getPlaintext(key) : undefined;
    const apiKey = plaintext ?? (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;

    steps.push({ step: 'Live Model Probe', status: 'info', message: `Issuing test probe for model '${modelId}'...` });
    const verifyResult = await this.executeLiveVerification(endpoint, apiKey, modelId);

    if (!verifyResult.ok) {
      steps.push({
        step: 'Probe Result',
        status: 'fail',
        message: `Model probe failed: ${verifyResult.error}.`,
      });

      if (verifyResult.status === 404 || verifyResult.status === 410) {
        this.deps.modelRegistry?.markModelUnhealthy(providerId, modelId, verifyResult.error ?? 'Model not found on provider', true);
        steps.push({ step: 'Model Status', status: 'info', message: `Model '${modelId}' confirmed absent upstream. Excluded from active routing.` });
      }

      const failReport: RemediationReport = {
        resolved: false,
        providerId,
        targetModel: modelId,
        actionTaken: 'model_unavailable_confirmed',
        steps,
        verification: 'failed',
        healthy: false,
        message: `Model '${modelId}' could not be verified on provider '${providerId}': ${verifyResult.error}`,
        recommendation: 'Model appears unavailable on upstream provider. Use alternative model or alias.',
        latencyMs: verifyResult.latencyMs,
        timestamp: Date.now(),
      };
      this.logRecovery(failReport, verifyResult.status, apiKey ? maskKeyString(apiKey) : undefined, verifyResult.latencyMs);
      return failReport;
    }

    // Model verified live!
    this.deps.modelRegistry?.markModelHealthy(providerId, modelId);
    this.deps.errorRegistry.recordSuccess(providerId, undefined, modelId);

    steps.push({
      step: 'Model Recovery',
      status: 'ok',
      message: `Model '${modelId}' verified live in ${verifyResult.latencyMs}ms. Status set to HEALTHY.`,
    });

    const successReport: RemediationReport = {
      resolved: true,
      providerId,
      targetModel: modelId,
      actionTaken: 'model_verified_and_recovered',
      steps,
      verification: 'passed',
      healthy: true,
      message: `Model '${modelId}' verified live and restored to active catalog.`,
      latencyMs: verifyResult.latencyMs,
      timestamp: Date.now(),
    };
    this.logRecovery(successReport, 200, apiKey ? maskKeyString(apiKey) : undefined, verifyResult.latencyMs);
    return successReport;
  }

  /**
   * Resolves a specific structured error diagnostic.
   */
  async resolveDiagnostic(diagnosticId: string): Promise<RemediationReport> {
    const diag = this.deps.errorRegistry.get(diagnosticId);
    if (!diag) {
      return {
        resolved: false,
        providerId: 'unknown',
        actionTaken: 'diagnostic_not_found',
        steps: [{ step: 'Init', status: 'fail', message: `Diagnostic ID '${diagnosticId}' not found.` }],
        verification: 'failed',
        healthy: false,
        message: `Diagnostic record '${diagnosticId}' not found.`,
        timestamp: Date.now(),
      };
    }

    if (diag.scope === 'KEY_FAILURE' && diag.keyId) {
      return this.resolveKey(diag.keyId);
    }
    if (diag.scope === 'MODEL_FAILURE' && diag.modelId) {
      return this.resolveModel(diag.providerId, diag.modelId);
    }
    return this.resolveProvider(diag.providerId);
  }

  // ─── Live Verification Helper ──────────────────────────────────────────

  private async executeLiveVerification(
    endpoint: ProviderEndpoint,
    apiKey?: string,
    targetModel?: string,
  ): Promise<{ ok: boolean; status?: number; retryAfterMs?: number; latencyMs: number; model?: string; error?: string }> {
    const adapter = this.deps.adapters?.get(endpoint.providerId);
    const start = Date.now();
    const testEndpoint = { ...endpoint, apiKey: apiKey ?? '' } as never;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      // If an adapter is available, attempt adapter healthCheck & minimal chat
      if (adapter) {
        // Step A: Adapter healthCheck (validates auth & connection)
        if (!targetModel) {
          const healthy = await adapter.healthCheck(testEndpoint, controller.signal).catch(() => false);
          if (healthy) {
            clearTimeout(timeout);
            return { ok: true, status: 200, latencyMs: Date.now() - start, model: 'auth:ok' };
          }
        }

        // Step B: Minimal 1-token test chat completion
        const testModel =
          targetModel ??
          this.deps.modelRegistry?.list().find((m) => !m.stale && m.providerId === endpoint.providerId)?.id ??
          (endpoint.providerId === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-3.5-turbo');

        const response = await adapter.chatCompletion(
          testEndpoint,
          {
            model: testModel,
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
          } as never,
          controller.signal,
        );

        clearTimeout(timeout);
        return {
          ok: true,
          status: 200,
          latencyMs: Date.now() - start,
          model: response.model || testModel,
        };
      }

      // Fallback: Direct HTTP probe to /models
      const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey && apiKey !== 'no-key-required') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return { ok: true, status: res.status, latencyMs, model: 'http:ok' };
      }

      if (res.status === 429) {
        const rawRetry = res.headers.get('retry-after');
        let retryAfterMs: number | undefined;
        if (rawRetry) {
          const deltaSecs = Number(rawRetry);
          if (Number.isFinite(deltaSecs) && deltaSecs > 0) {
            retryAfterMs = deltaSecs * 1000;
          } else {
            const parsed = Date.parse(rawRetry);
            if (Number.isFinite(parsed) && parsed > Date.now()) {
              retryAfterMs = parsed - Date.now();
            }
          }
        }
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          status: 429,
          retryAfterMs,
          latencyMs,
          error: `HTTP 429: Too Many Requests${retryAfterMs ? ` (Retry-After: ${Math.ceil(retryAfterMs / 1000)}s)` : ''} — ${errText.slice(0, 150)}`,
        };
      }

      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    } catch (err) {
      clearTimeout(timeout);
      const status = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode;
      const retryAfterMs =
        (err as { retryAfterMs?: number })?.retryAfterMs ??
        (typeof (err as { retryAfter?: unknown })?.retryAfter === 'number'
          ? (err as { retryAfter: number }).retryAfter * 1000
          : undefined);
      return {
        ok: false,
        status,
        retryAfterMs,
        latencyMs: Date.now() - start,
        error: (err as Error).message || 'Upstream connection failed',
      };
    }
  }

  private logRecovery(
    report: RemediationReport,
    status?: number,
    maskedKey?: string,
    durationMs?: number,
    correlationId?: string,
  ): void {
    const lines = [
      `[ERROR-RECOVERY]`,
      `provider=${report.providerId}`,
      report.targetModel ? `model=${report.targetModel}` : null,
      status != null ? `error=${status}` : null,
      `action=${report.actionTaken}`,
      maskedKey ? `key=${maskedKey}` : null,
      `verification=${report.verification}`,
      `duration=${durationMs ?? report.latencyMs ?? 0}ms`,
      correlationId ? `correlationId=${correlationId}` : null,
    ].filter(Boolean);
    // eslint-disable-next-line no-console
    console.log(lines.join(' '));
  }
}
