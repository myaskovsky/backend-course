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
 * End-to-end test for text-format conversion.
 *
 * Requires a running PostgreSQL and applied migrations (`npm run migration:run`),
 * like the user-management e2e. Exercises the real Fastify kernel via
 * light-my-request (`app.inject`) with hand-built multipart bodies.
 */
const BOUNDARY = '----e2econvertboundary';

function multipartBody(file: {
  filename: string;
  content: string;
  targetFormat: string;
}): { body: string; headers: Record<string, string> } {
  const body =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="targetFormat"\r\n\r\n` +
    `${file.targetFormat}\r\n` +
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n` +
    `${file.content}\r\n` +
    `--${BOUNDARY}--\r\n`;
  return {
    body,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

describe('Text-format conversion (e2e)', () => {
  let app: NestFastifyApplication;
  let accessToken: string;
  const email = `e2e-convert+${Date.now()}@example.com`;
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
    accessToken = login.cookies.find((c) => c.name === 'access_token')!.value;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication', async () => {
    const { body, headers } = multipartBody({
      filename: 'data.json',
      content: '{"a":1}',
      targetFormat: 'yaml',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('converts JSON to YAML', async () => {
    const { body, headers } = multipartBody({
      filename: 'data.json',
      content: '{"name":"Ann","age":30}',
      targetFormat: 'yaml',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      cookies: { access_token: accessToken },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('converted.yaml');
    expect(res.body).toContain('name: Ann');
  });

  it('converts CSV to JSON', async () => {
    const { body, headers } = multipartBody({
      filename: 'data.csv',
      content: 'name,age\nAnn,30\n',
      targetFormat: 'json',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      cookies: { access_token: accessToken },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ name: 'Ann', age: '30' }]);
  });

  it('rejects a malformed file with 400', async () => {
    const { body, headers } = multipartBody({
      filename: 'data.json',
      content: '{bad',
      targetFormat: 'yaml',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/convert',
      headers,
      cookies: { access_token: accessToken },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists 12 supported conversion directions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/convert/formats',
      cookies: { access_token: accessToken },
    });
    expect(res.statusCode).toBe(200);
    const pairs = res.json<Array<{ source: string; target: string[] }>>();
    expect(pairs).toHaveLength(4);
    expect(pairs.reduce((n, p) => n + p.target.length, 0)).toBe(12);
  });
});
