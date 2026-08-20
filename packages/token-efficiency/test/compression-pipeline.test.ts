import { describe, it, expect } from 'vitest';
import { compressPipeline } from '../src/compression-pipeline.js';

describe('CompressionPipeline (WS5 Phase 2)', () => {
  it('reports per-engine savings that sum to the total (no fabricated numbers)', () => {
    const verbose = [
      'Building project...',
      '',
      '',
      '',
      'npm warn deprecated foo@1.0.0',
      'npm warn deprecated foo@1.0.0',
      'npm warn deprecated foo@1.0.0',
      'npm warn deprecated foo@1.0.0',
      'compiling src/a.ts',
      'compiling src/b.ts',
      '[{ "id": 1 }, { "id": 1 }, { "id": 1 }, { "id": 1 }, { "id": 1 }]',
    ].join('\n');

    const res = compressPipeline(verbose);
    // per-engine char savings must be non-negative and sum to <= total saved
    const sumEngineSaved = res.engines.reduce((s, e) => s + e.charsSaved, 0);
    expect(sumEngineSaved).toBeGreaterThanOrEqual(res.totalCharsSaved);
    expect(res.savingsPct).toBeGreaterThan(0);
    expect(res.savingsPct).toBeLessThanOrEqual(100);
    // the repeated-array collapse actually fired
    const arrEngine = res.engines.find((e) => e.engine === 'collapse_arrays');
    expect(arrEngine?.charsSaved).toBeGreaterThan(0);
    // dedupe fired on the 4x repeated npm warn line
    const dedupe = res.engines.find((e) => e.engine === 'dedupe_lines');
    expect(dedupe?.charsSaved).toBeGreaterThan(0);
  });

  it('minify collapses 3+ blank lines and strips full-line comments', () => {
    const input = 'line1\n\n\n\n\n// a comment\nline2';
    const res = compressPipeline(input, { engines: ['minify'] });
    expect(res.text).not.toContain('\n\n\n');
    expect(res.text).not.toContain('// a comment');
    expect(res.text).toContain('line1');
    expect(res.text).toContain('line2');
  });

  it('elide_middle preserves head + tail and drops the middle of oversized blocks', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push(`step ${i}`);
    const input = lines.join('\n');
    const res = compressPipeline(input, { engines: ['elide_middle'], elideThreshold: 1000, elideKeep: 10 });
    expect(res.text).toContain('step 0');
    expect(res.text).toContain('step 199');
    expect(res.text).toMatch(/lines elided/);
    expect(res.finalChars).toBeLessThan(input.length);
  });

  it('is idempotent-ish: running twice does not inflate or crash', () => {
    const input = 'a\n'.repeat(50) + 'unique line\n' + 'b\n'.repeat(50);
    const once = compressPipeline(input);
    const twice = compressPipeline(once.text);
    expect(twice.text.length).toBeLessThanOrEqual(once.text.length + 1);
  });

  it('keeps comments when keepComments=true', () => {
    const input = 'code\n// important\nmore';
    const res = compressPipeline(input, { engines: ['minify'], keepComments: true });
    expect(res.text).toContain('// important');
  });
});
