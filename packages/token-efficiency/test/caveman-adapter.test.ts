import { describe, it, expect } from 'vitest';
import { createCavemanCompressor } from '../src/caveman-adapter.js';
import { ExternalCompressorRegistry } from '../src/external-compressor.js';

describe('createCavemanCompressor (real upstream adapter)', () => {
  it('builds a handle with the correct name + description for the nlp mode', () => {
    const h = createCavemanCompressor({ mode: 'nlp', cliDir: '/opt/caveman' });
    expect(h.name).toBe('caveman');
    expect(h.description).toContain('nlp');
    expect(typeof h.compress).toBe('function');
  });

  it('builds distinct handles per mode (nlp/mlm/llm)', () => {
    for (const mode of ['nlp', 'mlm', 'llm'] as const) {
      const h = createCavemanCompressor({ mode, cliDir: '/opt/caveman' });
      expect(h.description).toContain(mode);
    }
  });

  it('registry fails safe when the upstream compressor throws (no corruption, honest error)', async () => {
    // Simulate a misconfigured/missing upstream WITHOUT spawning a real process,
    // so the contract is verified deterministically in any environment (CI included).
    const reg = new ExternalCompressorRegistry();
    reg.register({
      name: 'caveman',
      description: 'caveman (simulated missing CLI)',
      compress: () => {
        throw new Error('spawn python3 ENOENT /nonexistent');
      },
    });
    const input = 'verbose text that must remain intact';
    const res = await reg.run('caveman', input);
    expect(res.output).toBe(input); // never corrupted
    expect(res.charsSaved).toBe(0);
    expect(res.error).toBeTruthy(); // honest: reports the failure
  });
});
