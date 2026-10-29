/**
 * Security regression tests (blueprint §11 #1 and #4):
 *   #1 secrets are never stored in plaintext — redaction at the boundary;
 *   #4 suspected leaked credentials are never hashed, never fingerprinted,
 *      and never tested — only redacted metadata is retained.
 */

import { describe, expect, it } from 'vitest';

import { MAX_ARRAY_LENGTH, MAX_STRING_LENGTH, REDACTIONS, looksLikeSecret, redactSecrets, scrubUntrustedPayload } from '../src/redaction.js';
import { sha256, evidenceDedupeKey } from '../src/connectors/base.js';

const OPENAI_STYLE = 'sk-AbCdEf1234567890AbCdEf1234567890';
const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';

describe('secret redaction gate (§11 #1)', () => {
  it('redacts openai-style keys, github tokens and JWTs with stable markers', () => {
    const out = redactSecrets(`leaked key ${OPENAI_STYLE} and ${GITHUB_TOKEN} and ${JWT}`);
    expect(out.redacted).toBe(true);
    expect(out.categories).toContain('openaiStyleKey');
    expect(out.categories).toContain('githubToken');
    expect(out.categories).toContain('jwtHeaderValue');
    expect(out.text).not.toContain(OPENAI_STYLE);
    expect(out.text).not.toContain(GITHUB_TOKEN);
    expect(out.text).not.toContain(JWT);
    expect(out.text).toContain(REDACTIONS.openaiStyleKey);
    expect(out.text).toContain(REDACTIONS.githubToken);
    expect(out.text).toContain(REDACTIONS.jwtHeaderValue);
  });

  it('never stores the raw secret anywhere in the scrubbed payload (deep object case)', () => {
    const payload = {
      note: `token: ${GITHUB_TOKEN}`,
      nested: { apiKey: 'AKIAIOSFODNN7EXAMPLE_BRANCH', deeper: [`Bearer ${OPENAI_STYLE}`] },
    };
    const scrubbed = scrubUntrustedPayload(payload);
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain(GITHUB_TOKEN);
    expect(serialized).not.toContain(OPENAI_STYLE);
  });

  it('drops values under credential-slot keys entirely (object-name danger pattern)', () => {
    const scrubbed = scrubUntrustedPayload({ api_key: 'super-secret-value-123456789', ok: 'fine' }) as Record<string, unknown>;
    expect(scrubbed['api_key']).toBe(REDACTIONS.credentialObjectName);
    expect(scrubbed['api_key']).not.toContain('super-secret');
    expect(scrubbed['ok']).toBe('fine');
  });

  it('redacts url credentials in the userinfo slot', () => {
    const out = redactSecrets('https://admin:hunter2@example.com/path');
    expect(out.redacted).toBe(true);
    expect(out.categories).toContain('urlCredentials');
    expect(out.text).not.toContain('hunter2');
  });

  it('bounds poison payloads: string cap and array cap', () => {
    const junk = 'x'.repeat(MAX_STRING_LENGTH * 3);
    const out = redactSecrets(junk);
    expect(out.text.length).toBeLessThanOrEqual(MAX_STRING_LENGTH + '…[truncated]'.length);

    const arr = scrubUntrustedPayload(Array.from({ length: MAX_ARRAY_LENGTH * 3 }, () => 1)) as unknown[];
    expect(arr.length).toBe(TRUNCATED_ARRAY_LENGTH);
  });

  it('reports looksLikeSecret for live credential patterns', () => {
    expect(looksLikeSecret(`connect with ${OPENAI_STYLE}`)).toBe(true);
    expect(looksLikeSecret('harmless configuration text')).toBe(false);
  });
});

describe('leaked-credential handling (§11 #4): never hashed, never fingerprinted', () => {
  it('the dedupe key is derived from source metadata only — never the secret value', () => {
    const withSecret = {
      connectorId: 'github-advisories',
      subjectType: 'security' as const,
      subjectId: 'repo:owner/name',
      claimType: 'credential-exposure',
      sourceUrl: 'https://github.com/example/issues/1',
      observedAtDay: '2026-01-01',
    };
    const keyA = evidenceDedupeKey(withSecret);
    const keyB = evidenceDedupeKey(withSecret);
    expect(keyA).toBe(keyB); // stable — but derived from metadata, not content
    const hashOfSecret = sha256(GITHUB_TOKEN);
    expect(keyA).not.toBe(hashOfSecret);
    // the key must not embed any part of the secret
    expect(keyA.startsWith(sha256(String(GITHUB_TOKEN)))).toBe(false);
  });
});

const TRUNCATED_ARRAY_LENGTH = MAX_ARRAY_LENGTH;
