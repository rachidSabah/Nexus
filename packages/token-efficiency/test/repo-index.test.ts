import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanRepository,
  rankRepository,
  selectRepositoryContext,
  parseGitPorcelain,
} from '../src/index.js';

let fixture: string;

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'anx-repo-'));
  const mk = (rel: string, content: string): void => {
    const abs = path.join(fixture, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  mk('src/index.ts', [
    "import { helper } from './helper.js';",
    "import fs from 'node:fs';",
    'export function add(a: number, b: number): number { return a + b; }',
    'export class Calculator {',
    '  add(a: number, b: number): number { return a + b; }',
    '}',
    'export interface Config { readonly name: string; }',
    'const x = 1;',
  ].join('\n'));
  mk('src/helper.ts', 'export const helper = (n: number): number => n * 2;\n');
  mk('README.md', '# Fixture\n\nDocs only.\n');
  mk('node_modules/dep/index.js', 'export const noise = true;\n');
  mk('.git/config', '[core]\n');
  mk('dist/bundle.js', 'export const built = "skip me";\n');
  mk('package-lock.json', '{}');
  mk('data/blob.bin', Buffer.alloc(64).toString('binary'));
});

afterAll(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('scanRepository (§20)', () => {
  it('indexes code files and ignores .git / node_modules / dist', () => {
    const res = scanRepository(fixture);
    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/helper.ts');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('node_modules/dep/index.js');
    expect(paths).not.toContain('.git/config');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).not.toContain('data/blob.bin');
    expect(paths).not.toContain('package-lock.json');
    expect(res.skippedDirs).toBeGreaterThan(0);
  });

  it('extracts capped symbols and local first-level dependencies', () => {
    const res = scanRepository(fixture);
    const indexFile = res.files.find((f) => f.path === 'src/index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile?.symbols).toContain('add');
    expect(indexFile?.symbols).toContain('Calculator');
    expect(indexFile?.symbols).toContain('Config');
    // 'node:fs' is NOT a local dep — only relative imports are kept.
    expect(indexFile?.deps).toEqual(['./helper.js']);
    expect(indexFile?.lineCount).toBeGreaterThan(0);
    expect(indexFile?.language).toBe('typescript');
  });

  it('lists coarse (non-code or oversized) files without symbols', () => {
    const res = scanRepository(fixture);
    const readme = res.files.find((f) => f.path === 'README.md');
    expect(readme?.language).toBe('markdown');
    expect(readme?.symbols).toEqual([]);
  });

  it('normalizes paths to forward slashes', () => {
    const res = scanRepository(fixture);
    expect(res.files.every((f) => !f.path.includes('\\'))).toBe(true);
  });
});

describe('rankRepository (§21)', () => {
  it('puts changed files first, then deterministic recency order', () => {
    const res = scanRepository(fixture);
    const ranked = rankRepository(res, ['src/helper.ts']);
    expect(ranked[0]?.path).toBe('src/helper.ts');
    expect(ranked[0]?.changed).toBe(true);
    expect(ranked[0]?.rank).toBe(1);
    // Changed first; indexes tie-broken by path (README.md before src/...).
    expect(ranked.slice(0, 3).map((f) => f.path)).toEqual([
      'src/helper.ts',
      'README.md',
      'src/index.ts',
    ]);
  });
});

describe('selectRepositoryContext (§21)', () => {
  it('caps by token budget and reports drops', () => {
    const res = scanRepository(fixture);
    const ranked = rankRepository(res, []);
    const sel = selectRepositoryContext(ranked, { maxTokens: 0 });
    expect(sel.files).toEqual([]);
    expect(sel.droppedForBudget).toBeGreaterThan(0);
    expect(sel.totalTokens).toBe(0);
  });

  it('caps by maxFiles', () => {
    const res = scanRepository(fixture);
    const ranked = rankRepository(res, []);
    const sel = selectRepositoryContext(ranked, { maxFiles: 1 });
    expect(sel.totalFiles).toBe(1);
    expect(sel.totalFiles + sel.droppedForBudget).toBe(ranked.length);
  });
});

describe('parseGitPorcelain (§21)', () => {
  it('parses modified / added / untracked / rename lines', () => {
    const out = [
      ' M src/index.ts',
      'A  src/new.ts',
      '?? README.md',
      'R  old.ts -> src/moved.ts',
      '',
    ].join('\n');
    const parsed = parseGitPorcelain(out);
    expect(parsed).toEqual([
      { status: 'M', path: 'src/index.ts' },
      { status: 'A', path: 'src/new.ts' },
      { status: '??', path: 'README.md' },
      { status: 'R', path: 'src/moved.ts' },
    ]);
  });

  it('handles CRLF output', () => {
    const parsed = parseGitPorcelain(' M a.ts\r\n M b.ts\r\n');
    expect(parsed.map((p) => p.path)).toEqual(['a.ts', 'b.ts']);
  });
});