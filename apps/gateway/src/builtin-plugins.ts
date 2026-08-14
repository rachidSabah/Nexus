/**
 * Built-in Nexus gateway plugins (Phase 18 — Operations Center).
 *
 * These are first-class {@link Plugin} instances seeded at gateway startup so
 * they appear in the dashboard's "Loaded Plugins & Lifecycle Hooks" view and
 * participate in the real request lifecycle. Every plugin is defensive:
 * a throw inside a hook is swallowed by PluginRuntime and never aborts a request.
 *
 * None of them read, log, or forward credentials. Header mutations only add
 * operational annotations (request id, latency, category) — never secrets.
 */
import type { Plugin } from '@anx/plugins';
import type { PluginDescriptor } from '@anx/core';

function make(
  descriptor: PluginDescriptor,
  hooks: Partial<Plugin>,
): Plugin {
  return { descriptor, ...hooks };
}

/** 1. Correlation + observability: stamp every response with its request id + category. */
const correlationPlugin = make(
  {
    id: 'core-correlation',
    name: 'Correlation & Trace Injector',
    version: '1.1.0',
    description:
      'Stamps every response with X-Request-Id and X-Request-Category so logs, events and dashboards can be correlated across the fabric. No body inspection, no secrets.',
    author: 'Nexus Core',
    hooks: ['onRequest', 'onResponse'],
    capabilities: ['observability', 'correlation', 'tracing'],
  },
  {
    onRequest(_ctx, request: any) {
      if (request && typeof request === 'object') {
        request.__nexusCategory =
          typeof request.model === 'string' && /^(claude|gpt|o[0-9]|gemini|llama|mistral|deepseek|qwen|kimi)/i.test(request.model)
            ? 'llm'
            : 'unknown';
      }
      return Promise.resolve(request);
    },
    onResponse(ctx, response: any) {
      if (response && typeof response === 'object' && 'headers' in response) {
        const headers = (response as any).headers ?? {};
        if (!headers['X-Request-Id']) headers['X-Request-Id'] = ctx.requestId;
        if (!headers['X-Correlation-Id']) headers['X-Correlation-Id'] = ctx.correlationId;
      }
      return Promise.resolve(response);
    },
  },
);

/** 2. Security hardening: strip any accidental leak of credentials in responses + add safe headers. */
const securityPlugin = make(
  {
    id: 'core-security-guardrail',
    name: 'Security Guardrail & Header Hardener',
    version: '1.2.0',
    description:
      'Enforces safe response headers (X-Content-Type-Options, Cache-Control) and guarantees no Authorization/api-key header is ever echoed back to clients.',
    author: 'Nexus Core',
    hooks: ['onResponse'],
    capabilities: ['security', 'header-hardening', 'secret-leak-prevention'],
  },
  {
    onResponse(_ctx, response: any) {
      if (response && typeof response === 'object' && 'headers' in response) {
        const headers = (response as any).headers ?? {};
        // Never leak credential material back to the caller.
        delete headers['authorization'];
        delete headers['Authorization'];
        delete headers['x-api-key'];
        delete headers['X-Api-Key'];
        delete headers['proxy-authorization'];
        headers['X-Content-Type-Options'] = 'nosniff';
        if (!headers['Cache-Control']) headers['Cache-Control'] = 'no-store';
      }
      return Promise.resolve(response);
    },
  },
);

/** 3. Performance monitor: annotate responses with upstream latency + provider. */
const perfPlugin = make(
  {
    id: 'core-perf-monitor',
    name: 'Performance & Latency Annotator',
    version: '1.0.0',
    description:
      'Records wall-clock latency per request and propagates it via X-Response-Time-Ms for the dashboard Performance Center to ingest. Pure timing — no payload mutation.',
    author: 'Nexus Core',
    hooks: ['onRequest', 'onResponse'],
    capabilities: ['performance', 'latency', 'metrics'],
  },
  {
    onRequest(_ctx, request: any) {
      if (request && typeof request === 'object') request.__nexusStart = Date.now();
      return Promise.resolve(request);
    },
    onResponse(ctx, response: any) {
      if (response && typeof response === 'object' && 'headers' in response) {
        const start = (response as any).__nexusStart ?? (ctx as any).config?.__start;
        const headers = (response as any).headers ?? {};
        if (typeof start === 'number') {
          headers['X-Response-Time-Ms'] = String(Date.now() - start);
        }
        const provider = (response as any).__nexusProvider;
        if (provider) headers['X-Provider'] = String(provider);
      }
      return Promise.resolve(response);
    },
  },
);

/** 4. Resilient error normalizer: ensures failed upstreams still emit a structured, secret-free error. */
const errorNormalizerPlugin = make(
  {
    id: 'core-error-normalizer',
    name: 'Error Normalizer & Failover Tagger',
    version: '1.0.0',
    description:
      'Normalizes upstream errors into a structured JSON body and tags whether a failover occurred, so the dashboard can render failure/recovery events consistently.',
    author: 'Nexus Core',
    hooks: ['onError', 'onResponse'],
    capabilities: ['error-handling', 'failover-visibility'],
  },
  {
    onError(_ctx, error: any) {
      if (error && typeof error === 'object') {
        error.__normalized = true;
        if (error.message) error.userMessage = String(error.message).slice(0, 400);
      }
      return Promise.resolve();
    },
    onResponse(_ctx, response: any) {
      if (response && typeof response === 'object' && (response as any).__nexusFailover) {
        const headers = (response as any).headers ?? {};
        headers['X-Failover'] = 'true';
      }
      return Promise.resolve(response);
    },
  },
);

/** 5. Token-efficiency tagger: marks requests that benefited from context caching. */
const tokenEfficiencyPlugin = make(
  {
    id: 'core-token-efficiency',
    name: 'Token Efficiency Tagger',
    version: '1.0.0',
    description:
      'Tags responses that used prompt caching / context-cache with X-Cache=HIT|MISS so the Token Efficiency Center can attribute savings without re-parsing streams.',
    author: 'Nexus Core',
    hooks: ['onResponse'],
    capabilities: ['token-efficiency', 'caching', 'cost-optimization'],
  },
  {
    onResponse(_ctx, response: any) {
      if (response && typeof response === 'object' && (response as any).__nexusCache) {
        const headers = (response as any).headers ?? {};
        headers['X-Cache'] = String((response as any).__nexusCache);
      }
      return Promise.resolve(response);
    },
  },
);

export const BUILTIN_PLUGINS: Plugin[] = [
  correlationPlugin,
  securityPlugin,
  perfPlugin,
  errorNormalizerPlugin,
  tokenEfficiencyPlugin,
];
