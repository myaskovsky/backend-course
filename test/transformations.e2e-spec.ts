import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  createTestApp,
  multipartBody,
  registerAndLogin,
} from './utils/test-app';

/**
 * End-to-end test for transformation history + result storage.
 * Requires a running PostgreSQL with migrations applied.
 */
interface HistoryItem {
  id: string;
  hasFile: boolean;
}

describe('Transformation history & storage (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    cookie = (await registerAndLogin(app, 'e2e-hist')).access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires auth for history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/transformations/history',
    });
    expect(res.statusCode).toBe(401);
  });

  it('saves a result, lists it in history, and downloads it', async () => {
    const { payload: body, headers } = multipartBody({
      filename: 'data.json',
      content: '{"name":"Ann"}',
      targetFormat: 'yaml',
      save: true,
    });
    const convert = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      cookies: { access_token: cookie },
      payload: body,
    });
    expect(convert.statusCode).toBe(200);

    const history = await app.inject({
      method: 'GET',
      url: '/api/transformations/history',
      cookies: { access_token: cookie },
    });
    expect(history.statusCode).toBe(200);
    const items = history.json<{ items: HistoryItem[] }>().items;
    const saved = items.find((i) => i.hasFile);
    expect(saved).toBeDefined();

    const download = await app.inject({
      method: 'GET',
      url: `/api/transformations/history/${saved!.id}/download`,
      cookies: { access_token: cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('converted.yaml');
    expect(download.body).toContain('name: Ann');
  });

  it('returns 404 downloading an item that has no saved file', async () => {
    const { payload: body, headers } = multipartBody({
      filename: 'data.json',
      content: '{"a":1}',
      targetFormat: 'xml',
    });
    await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      cookies: { access_token: cookie },
      payload: body,
    });
    const history = await app.inject({
      method: 'GET',
      url: '/api/transformations/history?targetFormat=xml',
      cookies: { access_token: cookie },
    });
    const item = history.json<{ items: HistoryItem[] }>().items[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/transformations/history/${item.id}/download`,
      cookies: { access_token: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
