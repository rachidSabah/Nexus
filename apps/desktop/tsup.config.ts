import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/main.ts', 'src/tray.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2022',
  platform: 'node',
});
