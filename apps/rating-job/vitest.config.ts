import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    alias: {
      '@prisma/client': new URL('./src/__mocks__/@prisma/client.ts', import.meta.url).pathname,
    },
  },
});
