import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  AuthCookies,
  createTestApp,
  login,
  registerAndLogin,
} from './utils/test-app';

interface Page {
  items: Array<{ id: string; email: string; lastLoginAt: string | null }>;
  nextCursor: string | null;
}

/**
 * Admin user list: keyset pagination against the real database. Logs in as
 * the admin seeded by the RBAC migration (ADMIN_EMAIL / ADMIN_PASSWORD).
 */
describe('Admin user list pagination (e2e)', () => {
  let app: NestFastifyApplication;
  let admin: AuthCookies;
  const marker = `e2e-page-${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await login(
      app,
      process.env.ADMIN_EMAIL ?? 'admin@example.com',
      process.env.ADMIN_PASSWORD ?? 'admin-change-me',
    );
    // Three matching users: two logged in (lastLoginAt set), one never.
    await registerAndLogin(app, `${marker}-a`);
    await registerAndLogin(app, `${marker}-b`);
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: `${marker}-c@example.com`, password: 'password123' },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const list = (query: Record<string, string | number>) =>
    app.inject({
      method: 'GET',
      url: '/admin/users',
      query: Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
      cookies: { access_token: admin.access_token },
    });

  /** Follows nextCursor until the end, collecting every page. */
  async function walk(
    query: Record<string, string | number>,
  ): Promise<Page['items']> {
    const items: Page['items'] = [];
    let cursor: string | null = null;
    do {
      const res = await list(cursor ? { ...query, cursor } : query);
      expect(res.statusCode).toBe(200);
      const page = res.json<Page>();
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  it.each([
    ['created_at', 'desc'],
    ['created_at', 'asc'],
    ['email', 'asc'],
    ['last_login', 'desc'],
    ['last_login', 'asc'],
  ])(
    'walks all pages without gaps or duplicates (sort=%s %s)',
    async (sort, order) => {
      const items = await walk({ q: marker, limit: 1, sort, order });
      expect(items).toHaveLength(3);
      expect(new Set(items.map((i) => i.id)).size).toBe(3);
      if (sort === 'last_login') {
        // NULLs (never logged in) always come last.
        expect(items[2].lastLoginAt).toBeNull();
      }
    },
  );

  it('treats LIKE wildcards in q literally', async () => {
    const res = await list({ q: '%' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Page>().items.every((i) => i.email.includes('%'))).toBe(
      true,
    );
  });

  it('rejects a garbage cursor with 400', async () => {
    expect((await list({ cursor: 'garbage' })).statusCode).toBe(400);
  });

  it('rejects a cursor used with a different sort with 400', async () => {
    const first = await list({
      q: marker,
      limit: 1,
      sort: 'email',
      order: 'asc',
    });
    const cursor = first.json<Page>().nextCursor!;
    const res = await list({ q: marker, limit: 1, sort: 'created_at', cursor });
    expect(res.statusCode).toBe(400);
  });

  it('validates limit bounds (1..100)', async () => {
    expect((await list({ limit: 1 })).statusCode).toBe(200);
    expect((await list({ limit: 0 })).statusCode).toBe(400);
    expect((await list({ limit: 101 })).statusCode).toBe(400);
  });
});
