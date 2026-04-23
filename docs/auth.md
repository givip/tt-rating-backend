# Authentication

tt-rating-core ships with a **pluggable auth layer**. The HTTP surface is fixed; the mechanism that turns an identifier + credential into a `{ userId, role }` is swappable.

## Default strategy

The default is **password (bcrypt)**. No SMS, no email, no external services required to run the server — a self-hoster can boot the stack, seed an admin, and log in. OTP and other strategies live behind the same interface and are opt-in.

## HTTP routes

All routes are prefixed with the app's global prefix (default `/api/v1`).

| Method | Path            | Purpose                                                |
|--------|-----------------|--------------------------------------------------------|
| POST   | `/auth/initiate`| Begin a multi-step flow (e.g. send OTP). No-op for `password`. Always returns `{ ok: true }` regardless of whether the identifier exists. |
| POST   | `/auth/login`   | Complete auth. Returns `{ accessToken, refreshToken, expiresIn }`. |
| POST   | `/auth/refresh` | Rotate refresh token. Returns a new `{ accessToken, refreshToken, expiresIn }`. |
| POST   | `/auth/logout`  | Revoke all refresh tokens for the caller. Requires `Authorization: Bearer <access>`. |

### Request bodies (zod-validated)

```ts
// POST /auth/initiate
{ identifier: string }

// POST /auth/login
{ identifier: string, credential: string }

// POST /auth/refresh
{ refreshToken: string }
```

Invalid bodies → `400 Bad Request` with `{"message":"Invalid request body"}`. Zod internals are never leaked.

## Environment variables

| Name                 | Default    | Notes                                                               |
|----------------------|------------|---------------------------------------------------------------------|
| `AUTH_STRATEGY`      | `password` | `password` or `phone-otp`. Unknown values fail at boot.             |
| `AUTH_ACCESS_TTL`    | `15m`      | `Ns` / `Nm` / `Nh` / `Nd` or bare seconds.                          |
| `AUTH_REFRESH_TTL`   | `30d`      | Same format.                                                        |
| `AUTH_BCRYPT_COST`   | `12`       | Minimum is clamped to 12 in code — lower values are rejected.       |
| `JWT_SECRET`         | (required) | HMAC key for access tokens. Boot fails in production if unset.      |

## Refresh-token semantics

- Access tokens: HMAC-signed JWTs, 15m default. Stateless.
- Refresh tokens: opaque random base64url strings (32 bytes). Stored in `RefreshToken` as `tokenHash = sha256hex(plaintext)` — plaintext never touches the DB.
- Every rotation mints a fresh row, marks the old row `revokedAt`, and links the two via `replacedBy` for auditability.
- **Reuse detection:** presenting a token whose `revokedAt` is non-null revokes every non-revoked token for that user and fails the call with `401 Refresh token reuse detected`. This invalidates both the attacker's chain and the victim's — the only safe response. See [apps/api/src/auth/token.service.ts](../apps/api/src/auth/token.service.ts) for the implementation.
- **Concurrency:** rotations run at `Serializable` isolation and use an atomic `updateMany({ where: { id, revokedAt: null } })` to claim the row. If two rotations race, only one wins; the loser is treated as reuse.

### Why chain revocation happens outside the transaction

An earlier iteration did the chain-wide revoke inside the same `$transaction` as the reuse-detection throw. Prisma rolls back on thrown errors, so the revoke writes were being discarded — leaving the chain alive. The fix: the transaction callback returns a discriminated result (`invalid` / `expired` / `reuse` / `ok`) and never throws; throws and the chain-wide `updateMany` happen after commit, on the outer `this.prisma` client.

## Rate limiting

`RateLimitService` caps login attempts per identifier at **5 failures per 15 minutes** (sliding window). Exceeding this throws `429 Too Many Requests`. The limit is checked *before* any DB or bcrypt work, so a flooded identifier can't burn CPU.

**Retention:** `LoginAttempt` rows have no automatic purge. Self-hosters should schedule a periodic delete (e.g. `DELETE FROM login_attempt WHERE created_at < NOW() - INTERVAL '30 days'`).

## Timing-safe miss path

`PasswordStrategy.complete` runs `bcrypt.compare(credential, DUMMY_HASH)` when the user is not found (or has `passwordHash = NULL`). This spends roughly the same CPU as a real compare, so `"user doesn't exist"` and `"wrong password"` are indistinguishable by response time.

`DUMMY_HASH` is a fixed bcrypt hash of a throwaway string. It isn't a secret — stability matters so behavior is reproducible across hosts.

## Writing a new strategy

1. Create a class that implements [`AuthStrategy`](../apps/api/src/auth/strategies/auth-strategy.interface.ts):

   ```ts
   @Injectable()
   export class MyStrategy implements AuthStrategy {
     readonly name = 'my-strategy';

     async initiate(input: AuthInitiateInput): Promise<void> {
       // Optional. For multi-step flows (OTP, magic links).
     }

     async complete(input: AuthCompleteInput): Promise<AuthenticatedUser> {
       // Verify credential, return { userId, role } or throw UnauthorizedException.
     }
   }
   ```

2. Register it in [`apps/api/src/auth/auth.module.ts`](../apps/api/src/auth/auth.module.ts): add it to `providers`, then extend the `AUTH_STRATEGY` factory to handle a new value of `process.env.AUTH_STRATEGY`.

3. Rate-limit usage: call `RateLimitService.check(identifier)` at the top of `complete` (and `initiate` if applicable), and `RateLimitService.record(identifier, success, ip)` at the end of each attempt.

4. Timing attacks: if your strategy involves a DB lookup, decide explicitly what to do when the identifier doesn't exist. Either mirror `PasswordStrategy`'s `DUMMY_HASH` pattern, or ensure the branches spend comparable time some other way.

5. Add tests under `apps/api/src/auth/strategies/` following the pattern of `password.strategy.test.ts`.

## Seeded admin (dev only)

The seed script creates `admin@ttr.ge` with bcrypt-hashed password `dev-admin-password`. **Rotate this before exposing the DB anywhere.** The seed emits a visible warning when it runs.
