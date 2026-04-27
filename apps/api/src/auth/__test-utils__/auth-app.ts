import {
  setupIntegrationApp,
  teardownIntegrationApp,
  IntegrationAppHandle,
} from '../../tournaments/__test-utils__/setup';

/**
 * Auth integration test bootstrap. Wraps the existing tournament integration
 * setup, but ensures the AUTH_PASSWORD_LOOKUP_FIELDS env is initialized to its
 * default before AppModule boots.
 */
export async function setupAuthApp(): Promise<IntegrationAppHandle> {
  process.env.AUTH_PASSWORD_LOOKUP_FIELDS =
    process.env.AUTH_PASSWORD_LOOKUP_FIELDS ?? 'email,phone';
  return setupIntegrationApp();
}

export const teardownAuthApp = teardownIntegrationApp;
export type { IntegrationAppHandle as AuthAppHandle };
