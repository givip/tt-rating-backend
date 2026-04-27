import { describe, it, expect } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Module, Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';

@Controller('echo')
class EchoController {
  @Get('cookie')
  echo(@Req() req: FastifyRequest & { cookies?: Record<string, string> }) {
    return { token: req.cookies?.auth_token ?? null, cookiesType: typeof req.cookies };
  }
}
@Module({ controllers: [EchoController] })
class EchoModule {}

describe('Fastify cookie plugin', () => {
  it('parses cookie header into req.cookies', async () => {
    const app = await NestFactory.create<NestFastifyApplication>(EchoModule, new FastifyAdapter({ logger: false }), { logger: false });
    await app.register(fastifyCookie as never);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const withCookie = await app.inject({ method: 'GET', url: '/echo/cookie', headers: { cookie: 'auth_token=hello' } });
    expect(withCookie.statusCode).toBe(200);
    expect(JSON.parse(withCookie.payload)).toEqual({ token: 'hello', cookiesType: 'object' });

    const withoutCookie = await app.inject({ method: 'GET', url: '/echo/cookie' });
    expect(withoutCookie.statusCode).toBe(200);
    expect(JSON.parse(withoutCookie.payload)).toEqual({ token: null, cookiesType: 'object' });

    await app.close();
  });
});
