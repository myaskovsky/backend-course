import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  AuthCookies,
  cookiesOf,
  createTestApp,
  registerAndLogin,
} from './utils/test-app';

/**
 * Security headers and instant token revocation, against the real database.
 */
describe('Auth: security headers & token revocation (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const me = (userId: string, cookies: Partial<AuthCookies>) =>
    app.inject({ method: 'GET', url: `/users/${userId}`, cookies });

  const refresh = (refreshToken: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh_token: refreshToken },
    });

  it('sends helmet security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('logout revokes the access and refresh tokens immediately', async () => {
    const session = await registerAndLogin(app, 'e2e-logout');
    expect((await me(session.userId, session)).statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { ...session },
    });
    expect(logout.statusCode).toBe(200);

    // The very same (unexpired, correctly signed) tokens are now rejected.
    expect((await me(session.userId, session)).statusCode).toBe(401);
    expect((await refresh(session.refresh_token)).statusCode).toBe(401);
  });

  it('refresh rotates tokens; replaying the old refresh token revokes the session', async () => {
    const session = await registerAndLogin(app, 'e2e-rotate');

    const first = await refresh(session.refresh_token);
    expect(first.statusCode).toBe(200);
    const rotated = cookiesOf(first.cookies);
    const refreshCookie = first.cookies.find((c) => c.name === 'refresh_token');
    expect(refreshCookie?.path).toBe('/auth');
    expect((await me(session.userId, rotated)).statusCode).toBe(200);

    // Reuse of the already-rotated token = theft signal → everything revoked.
    expect((await refresh(session.refresh_token)).statusCode).toBe(401);
    expect((await me(session.userId, rotated)).statusCode).toBe(401);
    expect((await refresh(rotated.refresh_token)).statusCode).toBe(401);
  });

  it('changing the password revokes other sessions but keeps the current one', async () => {
    const session = await registerAndLogin(app, 'e2e-passwd');

    const change = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      cookies: { access_token: session.access_token },
      payload: {
        currentPassword: 'password123',
        newPassword: 'new-password-123',
      },
    });
    expect(change.statusCode).toBe(200);
    const current = cookiesOf(change.cookies);

    expect((await me(session.userId, session)).statusCode).toBe(401);
    expect((await refresh(session.refresh_token)).statusCode).toBe(401);
    expect((await me(session.userId, current)).statusCode).toBe(200);
  });
});
