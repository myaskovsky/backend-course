import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '../../src/core/app/app.module';
import { configureApp } from '../../src/core/app/configure-app';

/**
 * Boots the real application with the same plugins and pipes as `main.ts`
 * (helmet, cookies, multipart, validation). Requires a running PostgreSQL
 * with migrations applied (`npm run migration:run`).
 */
export async function createTestApp(): Promise<NestFastifyApplication> {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface AuthCookies {
  access_token: string;
  refresh_token: string;
}

/** Logs in and returns the auth cookies. */
export async function login(
  app: NestFastifyApplication,
  email: string,
  password: string,
): Promise<AuthCookies & { userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed (${res.statusCode}): ${res.body}`);
  }
  return {
    ...cookiesOf(res.cookies),
    userId: res.json<{ id: string }>().id,
  };
}

/** Registers a fresh user and logs in. */
export async function registerAndLogin(
  app: NestFastifyApplication,
  prefix: string,
  password = 'password123',
): Promise<AuthCookies & { userId: string; email: string }> {
  const email = `${prefix}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const register = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password },
  });
  if (register.statusCode !== 201) {
    throw new Error(
      `Register failed (${register.statusCode}): ${register.body}`,
    );
  }
  return { ...(await login(app, email, password)), email };
}

export function cookiesOf(
  cookies: Array<{ name: string; value: string }>,
): AuthCookies {
  const get = (name: string) => cookies.find((c) => c.name === name)?.value;
  return {
    access_token: get('access_token') ?? '',
    refresh_token: get('refresh_token') ?? '',
  };
}

const BOUNDARY = '----e2eboundary';

/** Hand-built multipart/form-data body (fields first, then the file). */
export function multipartBody(fields: {
  filename: string;
  content: string | Buffer;
  targetFormat?: string;
  save?: boolean;
}): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  const field = (name: string, value: string) =>
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  if (fields.targetFormat !== undefined) {
    field('targetFormat', fields.targetFormat);
  }
  if (fields.save !== undefined) {
    field('save', String(fields.save));
  }
  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fields.filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(fields.content),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}
