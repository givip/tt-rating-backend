import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Separate config so `pnpm test` stays fast (mocked-Prisma only) and
 * `pnpm test:integration` runs the slower real-DB suite via Testcontainers.
 *
 * Uses SWC instead of ESBuild for TS transform because integration tests
 * load the full AppModule, and Nest's DI relies on `emitDecoratorMetadata`
 * (`design:paramtypes`) that ESBuild strips. SWC preserves it.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
      },
    }),
  ],
  test: {
    include: ['src/**/*.integration.test.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
