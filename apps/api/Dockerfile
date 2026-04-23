FROM node:20-alpine AS base
RUN npm install -g pnpm@9.15.0

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/glicko/package.json packages/glicko/
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm turbo build --filter=@tt-rating/api

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
