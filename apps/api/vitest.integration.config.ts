import { defineConfig } from 'vitest/config';

/**
 * Separate config so `pnpm test` stays fast (mocked-Prisma only) and
 * `pnpm test:integration` runs the slower real-DB suite via Testcontainers.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // One container start takes ~5s; some tests do more setup. Default 5s
    // hookTimeout is too tight, so bump to 60s.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Tests share state per-file via beforeAll; running files concurrently
    // would multiply container starts AND share DSNs unsafely. Force serial
    // file execution.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
