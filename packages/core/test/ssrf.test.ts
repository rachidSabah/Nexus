import { describe, it, expect } from 'vitest';
import { isSsrfSafe, assertSsrfSafe } from '../src/security/ssrf.js';

describe('SSRF guard (Phase 16 §8)', () => {
  it('allows public https URLs', () => {
    expect(isSsrfSafe('https://api.openai.com/v1')).toBe(true);
    expect(isSsrfSafe('http://example.com:8080/models')).toBe(true);
  });

  it('blocks loopback (127.0.0.1)', () => {
    expect(isSsrfSafe('http://127.0.0.1:8000')).toBe(false);
    expect(isSsrfSafe('https://localhost/models')).toBe(false);
  });

  it('blocks link-local / cloud metadata (169.254.169.254)', () => {
    expect(isSsrfSafe('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('blocks private ranges (10/8, 172.16/12, 192.168/16, 0.0.0.0)', () => {
    expect(isSsrfSafe('http://10.0.0.5')).toBe(false);
    expect(isSsrfSafe('http://172.16.5.5')).toBe(false);
    expect(isSsrfSafe('http://192.168.1.1')).toBe(false);
    expect(isSsrfSafe('http://0.0.0.0:9000')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isSsrfSafe('file:///etc/passwd')).toBe(false);
    expect(isSsrfSafe('gopher://evil')).toBe(false);
  });

  it('rejects unparseable URLs', () => {
    expect(isSsrfSafe('not a url')).toBe(false);
  });

  it('allows loopback with allowPrivate (local providers like Ollama)', () => {
    expect(isSsrfSafe('http://127.0.0.1:11434', { allowPrivate: true })).toBe(true);
    expect(isSsrfSafe('http://localhost:11434', { allowPrivate: true })).toBe(true);
  });

  it('honours explicit allowlist', () => {
    expect(isSsrfSafe('http://ollama', { allowlist: ['ollama'] })).toBe(true);
  });

  it('assertSsrfSafe throws on unsafe URL', () => {
    expect(() => assertSsrfSafe('http://169.254.169.254/')).toThrow();
    expect(() => assertSsrfSafe('https://api.openai.com')).not.toThrow();
  });
});
