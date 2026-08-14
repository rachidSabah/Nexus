import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2022',
  platform: 'node',
  // NOTE: no `banner` here — src/bin.ts already carries its own shebang.
  // Adding a banner caused a duplicated `#!/usr/bin/env node` in dist/bin.js,
  // which Node rejects with "SyntaxError: Invalid or unexpected token".
});
