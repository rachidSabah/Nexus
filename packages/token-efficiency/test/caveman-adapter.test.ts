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

  it('delegates to the registry; a missing CLI fails safe (original text, no fake saving)', async () => {
    const reg = new ExternalCompressorRegistry();
    // Point at a non-existent CLI dir so spawn errors — proves no corruption.
    reg.register(createCavemanCompressor({ mode: 'nlp', cliDir: '/nonexistent/caveman-cli' }));
    const input = 'verbose text that must remain intact';
    const res = await reg.run('caveman', input);
    expect(res.output).toBe(input); // never corrupted
    expect(res.charsSaved).toBe(0);
    expect(res.error).toBeTruthy(); // honest: reports the failure
  });
});
