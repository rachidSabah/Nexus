import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const distBin = resolve(__dirname, '..', 'dist', 'bin.js');

describe('@anx/cli bin declaration', () => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  it('declares the `anx` executable', () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin.anx).toBe('./dist/bin.js');
  });

  it('builds dist/bin.js with a node shebang', () => {
    expect(existsSync(distBin), 'dist/bin.js must be built (run `pnpm --filter @anx/cli build`)').toBe(true);
    const head = readFileSync(distBin, 'utf8').slice(0, 64);
    expect(head.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
