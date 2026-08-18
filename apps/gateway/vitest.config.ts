import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Server bootstrap + model discovery + agent detection run inside beforeAll
    // hooks; on a cold CI runner these legitimately take longer than vitest's
    // 10s default hookTimeout. Raise it so a slow-but-valid bootstrap never
    // fails CI (the assertions themselves are fast and already pass).
    hookTimeout: 60000,
    testTimeout: 30000,
    coverage: { provider: 'v8', reporter: ['text', 'json', 'html'], include: ['src/**/*.ts'] },
  },
});
