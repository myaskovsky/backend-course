import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from '@/core/config/config.service';

/**
 * Registers the Fastify plugins and global pipes shared by the real bootstrap
 * (`main.ts`) and the e2e suites, so tests exercise the same HTTP stack as
 * production.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const configService = app.get(ConfigService);
  const secureCookies = String(configService.get('COOKIE_SECURE')) === 'true';

  // Security headers. The CSP allows inline scripts/styles and data: images
  // only because Swagger UI (/docs) needs them; everything else is 'self'.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: secureCookies ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    // HSTS only makes sense when the app is served over HTTPS.
    hsts: secureCookies
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  });

  await app.register(compression);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: configService
      .get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.register(fastifyCookie, {
    secret: configService.get('COOKIE_SECRET'),
  });

  // Outer cap on uploads: the largest per-source-format limit. The finer
  // per-format limit is enforced while the upload is streamed to disk.
  const maxUploadBytes = Math.max(
    Number(configService.get('CONVERT_MAX_SIZE_CSV')),
    Number(configService.get('CONVERT_MAX_SIZE_JSON')),
    Number(configService.get('CONVERT_MAX_SIZE_XML')),
    Number(configService.get('CONVERT_MAX_SIZE_YAML')),
  );
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: maxUploadBytes },
  });
}
