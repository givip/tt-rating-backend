export interface AuthInitiateInput { identifier: string; meta?: Record<string, unknown>; }
export interface AuthCompleteInput { identifier: string; credential: string; meta?: Record<string, unknown>; }
export interface AuthenticatedUser { userId: string; role: string; }

export interface AuthStrategy {
  readonly name: string;
  /** For multi-step flows like OTP. No-op for password. */
  initiate?(input: AuthInitiateInput): Promise<void>;
  /** Returns authenticated user or throws UnauthorizedException. */
  complete(input: AuthCompleteInput): Promise<AuthenticatedUser>;
}

export const AUTH_STRATEGY = Symbol('AUTH_STRATEGY');
