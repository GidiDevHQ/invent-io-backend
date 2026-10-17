import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';

/**
 * Generates docs/openapi.json from the live Nest routes, for the frontend to
 * load into a mock server. Run: `npm run openapi:export`.
 * Reflects whatever modules are registered in AppModule at run time.
 */
async function main() {
    const app = await NestFactory.create(AppModule, { logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    const config = new DocumentBuilder()
        .setTitle('Invent-IO API')
        .setDescription('Payment-triggered inventory backend')
        .setVersion('1.0')
        .addBearerAuth()
        .build();

    const document = SwaggerModule.createDocument(app, config);
    writeFileSync('docs/openapi.json', JSON.stringify(document, null, 2));

    await app.close();
    // eslint-disable-next-line no-console
    console.log(`wrote docs/openapi.json (${Object.keys(document.paths ?? {}).length} paths)`);
    process.exit(0);
}

void main();
