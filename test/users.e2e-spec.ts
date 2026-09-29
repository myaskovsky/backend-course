import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createTestApp, login } from './utils/test-app';

/**
 * End-to-end smoke test for the user-management flow over the real Fastify
 * kernel (light-my-request via `app.inject`).
 */
describe('User management (e2e)', () => {
  let app: NestFastifyApplication;
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'password123';

  beforeAll(async () => {
    app = await createTestApp();
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

    const session = await login(app, email, password);
    expect(session.access_token).not.toBe('');
    expect(session.refresh_token).not.toBe('');

    const profile = await app.inject({
      method: 'GET',
      url: `/users/${session.userId}`,
      cookies: { access_token: session.access_token },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ email: string }>().email).toBe(email);
  });
});
