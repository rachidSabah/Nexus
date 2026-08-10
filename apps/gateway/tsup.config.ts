import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  banner: ({ entry }) => (entry === 'src/bin.ts' ? { js: '#!/usr/bin/env node' } : {}),
  noExternal: ['@anx/*'],
});
