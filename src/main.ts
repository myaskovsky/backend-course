import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from '@/core/app/app.module';
import { configureApp } from '@/core/app/configure-app';
import { ConfigService } from '@/core/config/config.service';

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.enableShutdownHooks();

  await configureApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('File Converter API')
    .setDescription(
      'Auth (JWT cookies), RBAC, user management and CSV/JSON/XML/YAML conversion',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(app.get(ConfigService).get('PORT'));
}

void bootstrap();
