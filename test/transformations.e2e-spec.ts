import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '../src/core/app/app.module';

/**
 * End-to-end test for transformation history + result storage.
 * Requires a running PostgreSQL with migrations applied.
 */
const BOUNDARY = '----e2ehistboundary';

function multipartBody(fields: {
  filename: string;
  content: string;
  targetFormat: string;
  save?: boolean;
}): { body: string; headers: Record<string, string> } {
  let body = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="targetFormat"\r\n\r\n${fields.targetFormat}\r\n`;
  if (fields.save !== undefined) {
    body += `--${BOUNDARY}\r\nContent-Disposition: form-data; name="save"\r\n\r\n${String(fields.save)}\r\n`;
  }
  body +=
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fields.filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n${fields.content}\r\n` +
    `--${BOUNDARY}--\r\n`;
  return {
    body,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

interface HistoryItem {
  id: string;
  hasFile: boolean;
}

describe('Transformation history & storage (e2e)', () => {
  let app: NestFastifyApplication;
  let cookie: string;
  const email = `e2e-hist+${Date.now()}@example.com`;
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
    await app.register(fastifyMultipart, {
      limits: { files: 1, fileSize: 5_242_880 },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    cookie = login.cookies.find((c) => c.name === 'access_token')!.value;
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
    const { body, headers } = multipartBody({
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
    const { body, headers } = multipartBody({
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
