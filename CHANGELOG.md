# Changelog

All notable changes to tt-rating-core are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Pluggable auth (Phase 1)

- `AuthStrategy` interface (`apps/api/src/auth/strategies/auth-strategy.interface.ts`) — strategies implement `name`, optional `initiate` (for multi-step flows like OTP), and `complete` (returns `{ userId, role }` or throws `UnauthorizedException`).
- `PasswordStrategy` — bcrypt with a minimum cost floor of 12. Timing-safe miss path uses a fixed `DUMMY_HASH` so attackers can't distinguish "user doesn't exist" from "wrong password" by response time.
- `PhoneOtpStrategy` — DB-backed 6-digit OTP stored as sha256 hex with a 5-minute TTL. Uses a pluggable `SmsProvider` (`ConsoleSmsProvider` logs to stdout in dev).
- `TokenService` — JWT access tokens (15m default) + 32-byte random refresh tokens stored in DB as sha256 hex. Refresh rotation is atomic (`Serializable` isolation + `updateMany` claim). Reuse of a revoked token revokes the entire chain for that user.
- `RateLimitService` — sliding-window DB-backed rate limit on login attempts (5 failures / 15 minutes per identifier). Records `LoginAttempt` rows.
- `AuthController` routes: `POST /auth/{initiate,login,refresh,logout}`. Strategy selection via `AUTH_STRATEGY` env var.
- Schema: `RefreshToken`, `AuthOtp`, `LoginAttempt` models; `User.email` and `User.passwordHash` columns; `User.phone` made optional.
- Seed: admin user `admin@ttr.ge` with bcrypt-hashed dev password `dev-admin-password` (rotate before production).

### Changed — BREAKING: auth environment variables

- **Removed:** `JWT_REFRESH_SECRET` — refresh tokens are now opaque random strings stored (hashed) in the DB; no HMAC is needed.
- **Added:**
  - `AUTH_STRATEGY` (`password` | `phone-otp`, default `password`)
  - `AUTH_ACCESS_TTL` (e.g. `15m`, default `15m`)
  - `AUTH_REFRESH_TTL` (e.g. `30d`, default `30d`)
  - `AUTH_BCRYPT_COST` (min enforced at 12, default 12)
- **Kept:** `JWT_SECRET` — required in production; the service fails to boot if unset with `NODE_ENV=production`.

### Migration

Existing users created before this change have `passwordHash = NULL` and cannot log in via `PasswordStrategy` until a password is set. For self-hosters coming from a pre-auth build: either reseed, or add a one-off script that sets a hashed password per user.

### Fixed

- Refresh-token reuse detection no longer has its chain-wide revocation rolled back by the `UnauthorizedException` thrown at the end of the same transaction. See [docs/auth.md](docs/auth.md) for the full rationale.
