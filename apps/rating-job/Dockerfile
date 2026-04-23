FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.0

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/glicko/package.json packages/glicko/
COPY apps/rating-job/package.json apps/rating-job/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm turbo build --filter=@tt-rating/rating-job

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/rating-job/dist ./apps/rating-job/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
CMD ["node", "apps/rating-job/dist/index.js"]
