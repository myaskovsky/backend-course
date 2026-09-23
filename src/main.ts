import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from './core/app/app.module';
import { ConfigService } from '@/core/config/config.service';

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(compression);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const configService = app.get(ConfigService);

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

  // File uploads for the conversion feature. The outer cap is the largest
  // per-source-format limit; ConversionsService enforces the finer per-format
  // limit once the source format is known.
  const maxUploadBytes = Math.max(
    Number(configService.get('CONVERT_MAX_SIZE_CSV')),
    Number(configService.get('CONVERT_MAX_SIZE_JSON')),
    Number(configService.get('CONVERT_MAX_SIZE_XML')),
    Number(configService.get('CONVERT_MAX_SIZE_YAML')),
  );
  await app.register(fastifyMultipart, {
    limits: { files: 1, fileSize: maxUploadBytes },
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('File Converter API')
    .setDescription(
      'User management: registration, auth (JWT cookies), RBAC, users CRUD',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('PORT');

  await app.listen(port);
}

void bootstrap();
