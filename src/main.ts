import './config/env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { RealtimeService } from './realtime/realtime.service';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const origins = parseCorsOrigins();
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (origins.length === 0 || origins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle('Invent-IO API')
    .setDescription('Payment-triggered inventory backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  app.use(
    '/reference',
    apiReference({
      content: openApiDocument,
      // Without this the browser tab reads the default "Scalar API Reference".
      pageTitle: 'Invent-IO API',
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);

  app.get(RealtimeService).init(app.getHttpServer());
}
void bootstrap();
