import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: !options.watch,
  sourcemap: true,
  clean: false,
  treeshake: true,
  target: 'es2022',
  platform: 'node',
}));
