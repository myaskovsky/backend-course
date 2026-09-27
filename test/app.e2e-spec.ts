import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '../src/core/app/app.module';

/**
 * End-to-end smoke test for the user-management flow.
 *
 * Requires a running PostgreSQL (see docker-compose.yml) and a populated .env,
 * with migrations applied (`npm run migration:run`). It exercises the real
 * Fastify HTTP kernel via light-my-request (`app.inject`).
 */
describe('User management (e2e)', () => {
  let app: NestFastifyApplication;
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'password123';

  beforeAll(async () => {
    initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('health endpoint is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects protected routes without an access cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(401);
  });

  it('registers, then logs in and sets auth cookies', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });
    expect(register.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const cookies = login.cookies.map((c) => c.name);
    expect(cookies).toContain('access_token');
    expect(cookies).toContain('refresh_token');

    const accessCookie = login.cookies.find((c) => c.name === 'access_token');
    const userId = login.json<{ id: string }>().id;

    const profile = await app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      cookies: { access_token: accessCookie!.value },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ email: string }>().email).toBe(email);
  });
});
