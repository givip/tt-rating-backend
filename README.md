# tt-rating-backend

Reference backend for a table-tennis rating platform. Built on
[`@tt-rating/core`](https://github.com/tt-rating/core) — the rating math
and pluggable formula interface live there; this repo is the HTTP + worker
+ persistence layer that makes them useful.

Self-host to run your own national or club-level rating system.

## What's included

- **REST API** — NestJS 10, phone/OTP or password auth, player registration, tournament lifecycle, club management, admin tools.
- **Rating worker** — async batch recalculation. Consumes `@tt-rating/core`; runs as any Node.js process.
- **Database schema** — Prisma 5 + PostgreSQL 16, migrations included.
- Cloud adapters (Cloud Run job trigger, SMS providers, Dockerfiles, CI) live in your own platform repo — swap them in via the pluggable interfaces this backend exposes. See `docs/extension-guide.md` (coming in a later phase).

## Packages on npm

| Package | Description |
|---|---|
| [`@tt-rating/core`](https://github.com/tt-rating/core) | Glicko-1 engine + `RatingFormula` interface |
| [`@tt-rating/types`](./packages/types) | Zod schemas + TypeScript types (internal) |

## Quick start

```bash
git clone https://github.com/tt-rating/backend tt-rating-backend
# Sibling clone of the core library — referenced via file link from this repo.
git clone https://github.com/tt-rating/core ../tt-rating-core

cd tt-rating-backend
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
docker compose up postgres -d
pnpm install
cd packages/db && pnpm exec prisma migrate deploy
cd ../.. && pnpm dev
```

API runs at http://localhost:3001 · Swagger at http://localhost:3001/api/docs

The file-link on `@tt-rating/core` is a local-dev convenience; production
builds will pin to a published version once core ships to npm.

## Deployment

Any PostgreSQL-compatible host works. Cloud-specific bits (Dockerfiles, CI,
Cloud Run triggers) are intentionally absent — wire them in from your
platform repo so the OSS backend stays portable.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
