# Changelog

All notable changes to tt-rating-core are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Tournament integration tests Tier 2 (2026-04-26)

- Four edge-case integration tests layered on top of Tier 1, total integration suite now 12 tests:
  - `groups-playoff.integration.test.ts`: Test 9 — N=22 truly-uneven groups [3,3,4,4,4,4]; exercises bracketShape with per-rank entrant counts and the multi-round phantom-propagation path in `advance.ts`.
  - `multi-event.integration.test.ts` (NEW): Test 10 — casual matches between Tournament A and Tournament B; verifies the rating pipeline composes (B's `ratingBefore` equals post-casual rating, not post-Tournament-A rating; B's seeds reflect post-casual ordering); Test 11 — 8 players × 3 tournaments; RD shrinks monotonically, provisional respects the ≥5-tournament threshold.
  - `lifecycle.integration.test.ts`: Test 12 — rewind preserves `withdrawnAt`; re-prepare excludes withdrawn players.
- New helper module `apps/api/src/tournaments/__test-utils__/lifecycle.ts`: `runFullLifecycle` (extracted from inline in `groups-playoff.integration.test.ts`) and `playCasualMatch` (proposes + accepts in one call).
- `createPlayer` now takes a `tokenService` argument and returns `accessToken`. Optional `tournamentsPlayed` parameter lets tests create non-provisional players upfront. Backwards-incompatible — every existing call site updated.

### Changed — `buildPlacementBrackets` supports non-uniform groups

- New call shape: `buildPlacementBrackets(groupsByRank: string[][])` where each entry lists the group letters that have an entrant at that rank. Sub-brackets are sized to the actual entrant count per rank — no more phantom slots when group sizes differ. Previous `(groupCount, groupSize)` shape preserved for backwards compatibility.
- `tournaments.service.ts` `prepare()` now computes `groupsByRank` from the actual snake-distributed groups before calling.

### Changed — `maybeAdvanceSubBracket` walks all rounds progressively

- For brackets with ≥3 rounds (size 8 or larger), the round-(N) → round-(N+1) transition needs to resolve `winnerOf` references that point back to round 1 or 2. The previous implementation only walked the just-completed round, so the local winners map was empty when round-2's pairings were processed and the transition got stuck.
- Now walks rounds 1..completedRound progressively, building `winnersByRound[r][pairingIdx]`. Subsequent rounds resolve their `winnerOf` refs against this transitive map. Required by Test 9.

### Fixed — `provisional` flip respects 5-tournament threshold

- `apps/rating-job/src/index.ts` previously set `provisional: false` after every tournament. The casual-match proposer gate reads `tournamentsPlayed < 5`; the boolean now matches: `provisional` is `true` until the player has played at least 5 tournaments. Surfaces in Test 11.

### Documented — `rewind` preserves `withdrawnAt`

- Added a code comment in `TournamentsService.rewind()` clarifying that `withdrawnAt` is intentionally preserved across rewind. A withdrawn player stays withdrawn through re-prepare cycles unless explicitly re-added by the organizer (DELETE → POST). Pinned by Test 12.

### Added — Tournament integration tests Tier 1 (2026-04-26)

- 8 real-Postgres integration tests covering both formats end-to-end via the full HTTP stack:
  - `round-robin.integration.test.ts`: N=4 smallest viable, N=7 Berger odd-N bye handling.
  - `groups-playoff.integration.test.ts`: N=16 gs=4 clean, N=12 gs=4 sub-bracket bye, N=15 gs=5 uniform, N=12 scripted RTTF tiebreaker.
  - `lifecycle.integration.test.ts`: rewind + re-prepare, drop in prepared with ≥2-entrants rule.
- Test infrastructure: `@testcontainers/postgresql` per-file ephemeral Postgres, real Prisma client, real NestJS+Fastify app via `app.inject(...)`. No mocks anywhere. Vitest config switched to SWC (`unplugin-swc`) so `emitDecoratorMetadata` survives the transform — required for Nest DI to wire `AppModule` cold.
- New `pnpm test:integration` script for the slow real-DB suite. Existing `pnpm test` stays mocked-Prisma only and fast (220 tests, <5s); explicitly excludes `*.integration.test.ts`.
- Test helpers under `apps/api/src/tournaments/__test-utils__/`: `setup.ts` (testcontainer + Nest bootstrap + organizer token), `factories.ts` (createPlayer, createTournament, addParticipants), `play-out.ts` (drives next-matches → PATCH result loop with override support).

### Changed — `advance.ts` finalPosition coverage and ≥2-entrants rule

- After a sub-bracket final completes, `finalPosition` is now written for **every** entrant in the sub-bracket, not just the winner + runner-up. Earlier-round losers fill `lo + 2 ..` ordered by (round descending, original tournament seed ascending). Previously only the 2 finalists got `finalPosition`, leaving other participants with `null`.
- Sub-brackets with fewer than 2 actual entrants are skipped at advance time:
  - Zero entrants → no-op.
  - One entrant → `finalPosition` assigned directly from the sub-bracket's `lo` value.
  Required by Test 7 (drop participant after prepare, group runs short) and any future scenario with non-uniform groups.

### Changed — rating-job skips withdrawn participants

- `processTournament` now filters tournament participants by `withdrawnAt: null`. Withdrawn rows stay for audit but get no `RatingChange` row and no Glicko delta — they didn't play any match.

### Changed — packaging cleanup

- `@tt-rating/types` `exports` map now includes a `default` condition (was `require` and `types` only). Vite's ESM-first resolver couldn't pick a target when the integration suite booted the full `AppModule`. Adding `default` is the standard "neither ESM nor CJS specifically" fallback.
- `apps/api/src/tournaments/draw/advance.ts` now imports `Prisma` types from `@tt-rating/db/generated` (the workspace package) instead of `'../../../../packages/db/generated'` (a relative path TS couldn't resolve via `tsc --noEmit`).

### Added — Tournament management v1 (2026-04-25)

- New `prepared` state in `TournamentStatus` between `open` and `in_progress`. Format and draw are decided at `prepare` time, after registrations close. `Tournament.format` is now nullable until prepare.
- Two formats supported: `round_robin` (Berger pairings) and `groups_playoff` (snake-seeded groups, full placement — every player plays through to a final position via parallel sub-brackets, one per `groupRank`). `single_elim` and `swiss` stay in the enum but `prepare` rejects them with `400 unsupported format in v1`.
- New endpoints under `/tournaments`:
  - `POST /:id/prepare` — runs the seeded draw atomically.
  - `POST /:id/rewind` — `prepared → open`; allowed only with zero `completed` matches; clears draw + matches + format.
  - `POST /:id/start` — `prepared → in_progress`.
  - `DELETE /:id/participants/:playerId` — hard-delete in `draft`/`open`, soft-delete (`withdrawnAt`) in `prepared`. Removes scheduled matches involving the dropped player.
  - `PATCH /:id/matches/:matchId/result` — records a result on a `scheduled` match; runs `advanceBracket` inline to write group ranks, generate next-round Match rows, and stamp `finalPosition` when sub-brackets resolve.
  - `GET /:id/standings` — RTTF tiebreaker cascade (points → H2H → sets ratio → points ratio, mini-table on tied subset only).
  - `GET /:id/next-matches?limit=N` — stateless prioritized queue, defaults `limit = numberOfTables`.
- New columns: `Tournament.numberOfTables` (default 1), `Tournament.groupSize`, `Tournament.bracketShape (Json)`, `TournamentParticipant.groupLetter / groupRank / withdrawnAt`, `Match.groupLetter / bracketLabel`.
- New index `Match(tournamentId, status, round)` for the next-matches query.
- New pure-function module `apps/api/src/tournaments/draw/`: `seeding.ts`, `round-robin.ts`, `group-draw.ts`, `bracket-shape.ts`, `tiebreakers.ts`, `advance.ts`. All have unit tests with no Prisma involvement.

### Changed — tightened state checks

- `POST /tournaments/:id/matches` (legacy) now rejects in `prepared`+ states (use the result PATCH instead).
- `POST /tournaments/:id/finalize` now rejects when status ≠ `in_progress`.
- `POST /tournaments` body no longer requires `format` (it's chosen at prepare time).

### Changed — schema tidy-up (2026-04-24)

- Dropped dead provenance columns from `players`: `rating_source`, `source_rating`, `source_url`, `import_date`. The `RatingSource` enum is removed entirely. The import seeded `internal_rating` once; nothing else read these columns.
- Added `updated_at DateTime @updatedAt` to `users`, `players`, `clubs`, `tournaments`, `tournament_participants`, `matches`, `rating_changes`. Prisma maintains the column on every update — no application code changes needed. Audit-only tables (`rating_snapshots`, `auth_otps`, `login_attempts`, `refresh_tokens`) intentionally skipped; `rating_config` already had one.
- Added `phone_verified_at DateTime?` and `email_verified_at DateTime?` to `users`. Nullable timestamps double as "is verified" + audit trail. No backfill — pre-existing users stay `NULL` until they re-verify.
- Added `address String?` and `phone String?` to `clubs`.
- Migration hand-edit: `DEFAULT CURRENT_TIMESTAMP` was added to each new `updated_at NOT NULL` column so the ALTER backfills existing rows safely. `@updatedAt` continues to drive the column at the ORM layer; the DB default is a belt-and-braces for raw-SQL writes.

### Breaking — admin CSV import

- `AdminService.parseCsvRow` no longer accepts a `source` column in the CSV. Importers must drop the column from their feeds. No migration path — the column was schema-layer-only.

### Added — Casual matches (2026-04-24)

- Endpoints under `/casual-matches`: `POST /` (propose), `GET /pending`, `POST /:id/accept`, `POST /:id/reject`, `DELETE /:id`; plus public `GET /players/:id/casual-matches` for history.
- Two-sided accept flow: a non-provisional proposer (`tournamentsPlayed ≥ 5`) creates a pending match; opponent has 7 days to accept or reject. Accept immediately triggers a per-match rating job.
- `RatingConfig.casual_weight_multiplier` (default `0.3`) — tunes how much casual matches move ratings relative to tournament matches. Final `matchWeight` = tournament set-count weight (bo5) × multiplier; stored on the row at creation so later tuning doesn't rewrite history.
- `processCasualMatch(matchId, prisma)` in the rating-job worker: one Glicko step per player, Postgres advisory locks on both player IDs in sorted order, idempotent via status transition `confirmed → completed` inside the same transaction.

### Changed — BREAKING: `RatingJobTrigger` signature

- `RatingJobTrigger.trigger` now takes `{ tournamentId?: string; matchId?: string }` (exactly one required) instead of a bare `tournamentId: string`. Platform repos with custom adapters must update. The Cloud Run adapter in the ttr.ge platform repo dispatches `TOURNAMENT_ID` or `MATCH_ID` env vars accordingly.

### Changed — schema (casual matches)

- `MatchStatus` enum gains `pending_opponent`, `confirmed`, `rejected`, `expired`.
- `RatingChangeType` enum gains `casual`.
- `Match.tournamentId` is now nullable; new `matchType`, `proposerId`, `confirmedAt`, `expiresAt` columns. Casual rows carry `tournamentId = null`.
- `Match.tournament_id` FK explicitly set to `ON DELETE RESTRICT` (prior auto-generated `ON DELETE SET NULL` would have orphaned tournament matches).
- New composite indexes `(player1Id, matchType, status)` and `(player2Id, matchType, status)` for pending-match queries.

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
