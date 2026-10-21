import './config/env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { RealtimeService } from './realtime/realtime.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // All routes are served under /v1. Breaking changes ship as a new version
  // (e.g. version: '2' on a controller) so existing clients keep working.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // OpenAPI document, rendered by Scalar at /reference (not Swagger UI).
  const openApiConfig = new DocumentBuilder()
    .setTitle('Invent-IO API')
    .setDescription('Payment-triggered inventory backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  app.use('/reference', apiReference({ content: openApiDocument }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);

  // Attach the Socket.IO realtime gateway to the running HTTP server.
  app.get(RealtimeService).init(app.getHttpServer());
}
void bootstrap();
