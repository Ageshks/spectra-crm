import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';


async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const get = <T>(key: string, fallback: T): T => {
    const value = config.get<T>(key);
    return (value ?? process.env[key] ?? fallback) as T;
  };
  const getApp = <T>(key: string, fallback: T): T => {
    const dotted = `app.${key}`;
    const direct = config.get<T>(dotted);
    if (direct !== undefined) return direct;
    const flat = config.get<T>(key);
    if (flat !== undefined) return flat;
    return fallback;
  };
  const isProduction = getApp<boolean>('isProduction', process.env.NODE_ENV === 'production');

  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
  const trustProxy = getApp<boolean>('trustProxy', process.env.TRUST_PROXY !== 'false');
  if (trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  const bodyLimit = getApp<string>('bodyLimit', process.env.BODY_LIMIT ?? '1mb');
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  const corsOrigins = getApp<string[]>('corsOrigins', []);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
        return callback(null, isProduction ? false : true);
      }
      return callback(null, corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  const apiPrefix = getApp<string>('apiPrefix', 'api/v1');
  app.setGlobalPrefix(apiPrefix, { exclude: ['health', 'api/docs', 'api/docs-json'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  const swaggerEnabled = getApp<boolean>('swaggerEnabled', process.env.SWAGGER_ENABLED === 'true');
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Water Treatment Service API')
      .setDescription(
        'Backend API for the Water Treatment Service & Field Workforce Management System',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'Spectra API Docs',
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  const port = getApp<number>('port', Number(process.env.PORT ?? 3000));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
