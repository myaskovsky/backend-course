import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from '@/core/config/config.service';

import { configureApp } from './configure-app';

interface HelmetOptions {
  contentSecurityPolicy: {
    directives: Record<string, string[] | null>;
  };
  crossOriginResourcePolicy: { policy: string };
  hsts: false | { maxAge: number; includeSubDomains: boolean };
}

describe('configureApp', () => {
  const baseConfig: Record<string, string> = {
    COOKIE_SECURE: 'false',
    COOKIE_SECRET: 'cookie-secret',
    CORS_ORIGINS: ' http://a.test , http://b.test,,',
    CONVERT_MAX_SIZE_CSV: '100',
    CONVERT_MAX_SIZE_JSON: '4000',
    CONVERT_MAX_SIZE_XML: '300',
    CONVERT_MAX_SIZE_YAML: '2000',
  };

  const setup = (overrides: Record<string, string> = {}) => {
    const values = { ...baseConfig, ...overrides };
    const configService = {
      get: jest.fn((k: string) => values[k]),
    } as unknown as ConfigService;
    const app = {
      register: jest.fn().mockResolvedValue(undefined),
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      get: jest.fn().mockReturnValue(configService),
    };
    return { app, configService };
  };

  const optionsFor = (app: { register: jest.Mock }, plugin: unknown) => {
    const call = app.register.mock.calls.find(([p]) => p === plugin);
    expect(call).toBeDefined();
    return (call as unknown[])[1];
  };

  it('resolves ConfigService from the app container', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    expect(app.get).toHaveBeenCalledWith(ConfigService);
  });

  it('registers helmet, compression, cookie and multipart plugins', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    const plugins = app.register.mock.calls.map(([p]) => p as unknown);
    expect(plugins).toEqual([
      fastifyHelmet,
      compression,
      fastifyCookie,
      fastifyMultipart,
    ]);
  });

  it('configures a strict CSP with frameAncestors none', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    const opts = optionsFor(app, fastifyHelmet) as HelmetOptions;
    const d = opts.contentSecurityPolicy.directives;
    expect(d.defaultSrc).toEqual(["'self'"]);
    expect(d.objectSrc).toEqual(["'none'"]);
    expect(d.frameAncestors).toEqual(["'none'"]);
    expect(d.imgSrc).toEqual(["'self'", 'data:', 'validator.swagger.io']);
    expect(opts.crossOriginResourcePolicy).toEqual({ policy: 'same-site' });
  });

  it('disables HSTS and upgrade-insecure-requests when COOKIE_SECURE is false', async () => {
    const { app } = setup({ COOKIE_SECURE: 'false' });
    await configureApp(app as unknown as NestFastifyApplication);
    const opts = optionsFor(app, fastifyHelmet) as HelmetOptions;
    expect(opts.hsts).toBe(false);
    expect(opts.contentSecurityPolicy.directives.upgradeInsecureRequests).toBe(
      null,
    );
  });

  it('enables HSTS and upgrade-insecure-requests when COOKIE_SECURE is true', async () => {
    const { app } = setup({ COOKIE_SECURE: 'true' });
    await configureApp(app as unknown as NestFastifyApplication);
    const opts = optionsFor(app, fastifyHelmet) as HelmetOptions;
    expect(opts.hsts).toEqual({ maxAge: 31_536_000, includeSubDomains: true });
    expect(
      opts.contentSecurityPolicy.directives.upgradeInsecureRequests,
    ).toEqual([]);
  });

  it('registers a whitelisting, transforming ValidationPipe', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    const pipe = (app.useGlobalPipes.mock.calls[0] as unknown[])[0];
    expect(pipe).toBeInstanceOf(ValidationPipe);
    const internals = pipe as {
      validatorOptions: { whitelist?: boolean };
      isTransformEnabled: boolean;
      transformOptions: { enableImplicitConversion?: boolean };
    };
    expect(internals.validatorOptions.whitelist).toBe(true);
    expect(internals.isTransformEnabled).toBe(true);
    expect(internals.transformOptions.enableImplicitConversion).toBe(true);
  });

  it('enables CORS with split, trimmed, non-empty origins and credentials', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    expect(app.enableCors).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['http://a.test', 'http://b.test'],
        credentials: true,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        optionsSuccessStatus: 204,
      }),
    );
  });

  it('passes the cookie secret to @fastify/cookie', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    expect(optionsFor(app, fastifyCookie)).toEqual({
      secret: 'cookie-secret',
    });
  });

  it('caps multipart uploads at the largest per-format size and one file', async () => {
    const { app } = setup();
    await configureApp(app as unknown as NestFastifyApplication);
    expect(optionsFor(app, fastifyMultipart)).toEqual({
      limits: { files: 1, fileSize: 4000 },
    });
  });

  it('picks whichever format limit is largest', async () => {
    const { app } = setup({ CONVERT_MAX_SIZE_YAML: '9999' });
    await configureApp(app as unknown as NestFastifyApplication);
    expect(optionsFor(app, fastifyMultipart)).toEqual({
      limits: { files: 1, fileSize: 9999 },
    });
  });
});
