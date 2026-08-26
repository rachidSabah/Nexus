import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Fastify server cold-start on CI runners can take >10s (the vitest default).
    // 60 s gives ample headroom without masking genuine infinite hangs.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
