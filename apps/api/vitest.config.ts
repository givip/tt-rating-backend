import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // *.integration.test.ts is run separately via vitest.integration.config.ts
    // (real-DB tests with Testcontainers + SWC). Exclude here so `pnpm test`
    // stays fast and doesn't try to bootstrap a Postgres container.
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
});
