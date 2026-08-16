import { describe, it, expect } from 'vitest';

import { classifyFailure } from '../src/index.js';
import { ProviderResponseError } from '../src/index.js';

describe('classifyFailure', () => {
  it('classifies 401 as invalidate-key + not-retryable', () => {
    const err = new ProviderResponseError('ep1', 401, 'Unauthorized');
    const c = classifyFailure(err);
    expect(c.status).toBe(401);
    expect(c.retryable).toBe(false);
    expect(c.keyAction).toBe('invalidate');
  });

  it('classifies 403 as invalidate-key + not-retryable', () => {
    const err = new ProviderResponseError('ep1', 403, 'Forbidden');
    const c = classifyFailure(err);
    expect(c.status).toBe(403);
    expect(c.retryable).toBe(false);
    expect(c.keyAction).toBe('invalidate');
  });

  it('classifies 402 Payment Required (CreditsError) as billing failure — retryable + mark_unavailable', () => {
    const err = new ProviderResponseError('ep1', 402, 'CreditsError: No payment method');
    const c = classifyFailure(err);
    expect(c.status).toBe(402);
    expect(c.retryable).toBe(true);
    expect(c.keyAction).toBe('none');
    expect(c.endpointAction).toBe('mark_unavailable');
  });

  it('classifies a 401 carrying a billing CreditsError body as billing failure — retryable + mark_unavailable', () => {
    const err = new ProviderResponseError(
      'ep1',
      401,
      '{"error":{"message":"CreditsError: Your credits have run out"}}',
    );
    const c = classifyFailure(err);
    expect(c.status).toBe(401);
    expect(c.retryable).toBe(true);
    expect(c.keyAction).toBe('none');
    expect(c.endpointAction).toBe('mark_unavailable');
  });

  it('classifies a 403 with a billing signal as billing (retryable), not auth', () => {
    const err = new ProviderResponseError('ep1', 403, 'quota exceeded');
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
    expect(c.endpointAction).toBe('mark_unavailable');
  });

  it('classifies 404 model-not-found as mark-unavailable + not-retryable', () => {
    const err = new ProviderResponseError('ep1', 404, 'model not found');
    const c = classifyFailure(err);
    expect(c.status).toBe(404);
    expect(c.retryable).toBe(false);
    expect(c.endpointAction).toBe('mark_unavailable');
  });

  it('classifies 408 timeout as retryable', () => {
    const err = new ProviderResponseError('ep1', 408, 'timeout');
    const c = classifyFailure(err);
    expect(c.status).toBe(408);
    expect(c.retryable).toBe(true);
    expect(c.endpointAction).toBe('record_failure');
  });

  it('classifies 429 rate-limited as cooldown-key + retryable', () => {
    const err = new ProviderResponseError('ep1', 429, 'Too Many Requests');
    const c = classifyFailure(err);
    expect(c.status).toBe(429);
    expect(c.retryable).toBe(true);
    expect(c.keyAction).toBe('cooldown');
  });

  it('classifies 413 context-exceeded as not-retryable', () => {
    const err = new ProviderResponseError('ep1', 413, 'payload too large');
    const c = classifyFailure(err);
    expect(c.status).toBe(413);
    expect(c.retryable).toBe(false);
  });

  it('classifies 400 bad-request as not-retryable client error', () => {
    const err = new ProviderResponseError('ep1', 400, 'bad request');
    const c = classifyFailure(err);
    expect(c.status).toBe(400);
    expect(c.retryable).toBe(false);
    expect(c.keyAction).toBe('none');
  });

  it('classifies 422 unprocessable as not-retryable client error', () => {
    const err = new ProviderResponseError('ep1', 422, 'unprocessable');
    const c = classifyFailure(err);
    expect(c.status).toBe(422);
    expect(c.retryable).toBe(false);
  });

  it('classifies 500 server error as retryable + mark-degraded', () => {
    const err = new ProviderResponseError('ep1', 500, 'Internal Server Error');
    const c = classifyFailure(err);
    expect(c.status).toBe(500);
    expect(c.retryable).toBe(true);
    expect(c.endpointAction).toBe('mark_degraded');
  });

  it('classifies 502 bad-gateway as retryable', () => {
    const err = new ProviderResponseError('ep1', 502, 'Bad Gateway');
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
    expect(c.endpointAction).toBe('mark_degraded');
  });

  it('classifies 503 service-unavailable as retryable', () => {
    const err = new ProviderResponseError('ep1', 503, 'Service Unavailable');
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
  });

  it('classifies 504 gateway-timeout as retryable', () => {
    const err = new ProviderResponseError('ep1', 504, 'Gateway Timeout');
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
  });

  it('classifies ECONNRESET as retryable network error', () => {
    const err = new Error('socket hang up') as Error & { code: string };
    err.code = 'ECONNRESET';
    const c = classifyFailure(err);
    expect(c.status).toBe(0);
    expect(c.code).toBe('ECONNRESET');
    expect(c.retryable).toBe(true);
    expect(c.endpointAction).toBe('mark_degraded');
  });

  it('classifies ETIMEDOUT as retryable network error', () => {
    const err = new Error('timeout') as Error & { code: string };
    err.code = 'ETIMEDOUT';
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
  });

  it('classifies ECONNREFUSED as retryable', () => {
    const err = new Error('refused') as Error & { code: string };
    err.code = 'ECONNREFUSED';
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
  });

  it('classifies ENOTFOUND as retryable', () => {
    const err = new Error('dns') as Error & { code: string };
    err.code = 'ENOTFOUND';
    const c = classifyFailure(err);
    expect(c.retryable).toBe(true);
  });

  it('classifies unknown errors as not-retryable', () => {
    const err = new Error('something weird happened');
    const c = classifyFailure(err);
    expect(c.retryable).toBe(false);
    expect(c.code).toBe('UNKNOWN');
  });

  it('includes a human-readable reason on every classification', () => {
    const cases = [
      new ProviderResponseError('ep1', 401, 'Unauthorized'),
      new ProviderResponseError('ep1', 429, 'Rate Limited'),
      new ProviderResponseError('ep1', 500, 'Server Error'),
      new ProviderResponseError('ep1', 404, 'Not Found'),
    ];
    for (const err of cases) {
      const c = classifyFailure(err);
      expect(c.reason).toBeTruthy();
      expect(c.reason.length).toBeGreaterThan(10);
    }
  });
});
