import { describe, it, expect } from 'vitest';
import { ExternalCompressorRegistry } from '../src/external-compressor.js';

describe('ExternalCompressorRegistry (honest external-engine hook)', () => {
  it('skips unregistered engines as a no-op with delegated:false (no fake saving)', async () => {
    const reg = new ExternalCompressorRegistry();
    const res = await reg.run('caveman', 'some verbose prompt text');
    expect(res.delegated).toBe(false);
    expect(res.charsSaved).toBe(0);
    expect(res.output).toBe('some verbose prompt text');
  });

  it('measures REAL savings from a registered upstream compressor', async () => {
    const reg = new ExternalCompressorRegistry();
    reg.register({
      name: 'caveman',
      description: 'Caveman (operator upstream)',
      compress: (t) => t.replace(/\s+/g, ' ').trim(),
    });
    const input = 'a  b    c';
    const res = await reg.run('caveman', input);
    expect(res.delegated).toBe(true);
    expect(res.output).toBe('a b c');
    expect(res.charsSaved).toBe(input.length - 'a b c'.length);
  });

  it('never corrupts the prompt when an external engine throws (no fake saving)', async () => {
    const reg = new ExternalCompressorRegistry();
    reg.register({
      name: 'rtk',
      description: 'RTK (broken upstream)',
      compress: () => {
        throw new Error('upstream 503');
      },
    });
    const input = 'keep this intact';
    const res = await reg.run('rtk', input);
    expect(res.output).toBe(input); // original preserved
    expect(res.charsSaved).toBe(0);
    expect(res.error).toContain('upstream 503');
  });

  it('supports unregister and list', () => {
    const reg = new ExternalCompressorRegistry();
    reg.register({ name: 'x', description: 'd', compress: (t) => t });
    expect(reg.has('x')).toBe(true);
    expect(reg.list()).toHaveLength(1);
    expect(reg.unregister('x')).toBe(true);
    expect(reg.has('x')).toBe(false);
  });
});
