# Contributing to tt-rating/core

Thank you for helping build open table tennis infrastructure!

## Getting started

```bash
git clone https://github.com/tt-rating/core
cd core
cp .env.example .env
docker compose up postgres -d
pnpm install
cd packages/db && pnpm exec prisma migrate dev
pnpm dev
```

## Running tests

```bash
pnpm turbo test
```

## Project structure

| Path | What it is |
|---|---|
| `packages/glicko` | Glicko-1 rating engine — zero deps, fully tested |
| `packages/types` | Zod request/response schemas shared across apps |
| `packages/db` | Prisma schema for all platform data |
| `apps/api` | NestJS REST API (auth, players, tournaments, clubs, admin) |
| `apps/rating-job` | Cloud Run Job: batch Glicko recalculation |

## Submitting changes

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Write tests first (TDD)
4. Run `pnpm turbo test typecheck` — must be green
5. Open a pull request against `main`

## Code style

- TypeScript strict mode, no `any`
- No comments that describe what the code does — only why
- Tests live next to source (`foo.ts` → `foo.test.ts`)
