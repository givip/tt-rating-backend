import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { hash } from 'bcrypt';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma.service';
import { TokenService } from '../../auth/token.service';
import type { PrismaClient } from '@tt-rating/db/generated';

export type IntegrationAppHandle = {
  app: NestFastifyApplication;
  prisma: PrismaClient;
  container: StartedPostgreSqlContainer;
  organizerToken: string;
  organizerId: string;
};

/**
 * Per-file lifecycle: spins up Postgres via Testcontainers, applies all
 * migrations, bootstraps a real NestJS+Fastify app pointed at the container's
 * DSN, seeds an organizer user, signs an access token, and returns a handle
 * tests use to drive the lifecycle.
 */
export async function setupIntegrationApp(): Promise<IntegrationAppHandle> {
  // 1. Spin up Postgres container.
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ttrge_test')
    .withUsername('ttrge')
    .withPassword('ttrge')
    .start();

  const dsn = container.getConnectionUri();

  // 2. Apply migrations against the container.
  // `prisma migrate deploy` is the production-equivalent migration runner.
  // Resolve the db package via __dirname so it works regardless of cwd.
  const dbPackageDir = path.resolve(__dirname, '../../../../../packages/db');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: dsn },
    stdio: 'inherit',
  });

  // 3. Bootstrap NestJS pointed at the container DSN.
  // Override DATABASE_URL BEFORE PrismaService instantiation so it picks up
  // the test DSN. JWT_SECRET is required at boot.
  process.env.DATABASE_URL = dsn;
  process.env.JWT_SECRET = 'integration-test-secret';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService) as unknown as PrismaClient;

  // 4. Seed one organizer user + sign a JWT for them.
  const organizerId = randomUUID();
  const passwordHash = await hash('test-pw', 12);
  await prisma.user.create({
    data: {
      id: organizerId,
      email: 'organizer@test.local',
      passwordHash,
      role: 'organizer',
    },
  });

  const tokenService = app.get(TokenService);
  const { accessToken } = await tokenService.issue(organizerId, 'organizer');

  return {
    app,
    prisma,
    container,
    organizerToken: accessToken,
    organizerId,
  };
}

export async function teardownIntegrationApp(handle: IntegrationAppHandle): Promise<void> {
  await handle.app.close();
  await handle.container.stop();
}

/**
 * Wipe match-graph + tournament + player tables, keeping the organizer user
 * and auth tables intact. CASCADE handles FK ordering automatically.
 */
export async function truncateTestData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE
       "rating_changes",
       "matches",
       "tournament_participants",
       "tournaments",
       "players"
     RESTART IDENTITY CASCADE`,
  );
}
