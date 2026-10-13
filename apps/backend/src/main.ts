import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  if (process.env.NODE_ENV === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      if (!process.env[k] || process.env[k]!.startsWith('CHANGE_ME')) {
        throw new Error(`${k} must be set to a strong random value (see .env.example)`);
      }
      if (process.env[k]!.length < 32) logger.warn(`${k} is shorter than 32 characters; use "openssl rand -hex 32"`);
    }
    if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
      logger.warn('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical; use two different secrets');
    }
  }
  const isProd = process.env.NODE_ENV === 'production';
  // HSTS only once HTTPS is confirmed (same switch that makes cookies Secure).
  const httpsConfirmed = process.env.COOKIE_SECURE === 'true';
  // ponytail: 'debug'/'verbose' log every request lifecycle event to stdout,
  // which adds noticeable latency in dev. Opt in with NEST_DEBUG_LOGS=1.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NEST_DEBUG_LOGS === '1' ? ['error', 'warn', 'log', 'debug'] : ['error', 'warn', 'log'],
  });

  // Behind the Next.js proxy (loopback in dev, docker network in compose): take the client IP from
  // X-Forwarded-For for per-IP rate limits.
  // ponytail: Next only sets X-Forwarded-For when absent, so clients can spoof it and dodge the anonymous
  // per-IP limit. Brute force is still stopped by the per-username login lockout. Put nginx/an LB in front
  // that overwrites the header if per-IP limits must be strict.
  app.set('trust proxy', 'loopback, uniquelocal');

  // Payload size limits (uploads are capped separately via UPLOAD_LIMITS)
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3000'],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: httpsConfirmed ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  }));

  // API responses carry private data: keep them out of shared caches and the browser's disk cache.
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Compression
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Swagger: development only; set ENABLE_SWAGGER=1 to expose it in production on purpose.
  const swaggerOn = !isProd || process.env.ENABLE_SWAGGER === '1';
  if (swaggerOn) {
    const config = new DocumentBuilder()
      .setTitle('VAPT Command Center API')
      .setDescription('Vulnerability Assessment & Penetration Testing Platform')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 4000;
  const server = await app.listen(port);
  // Bound slow-request exposure (uploads are capped at 25 MB; report generation runs in a queue).
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  logger.log(`VAPT Command Center API running on port ${port}`);
  if (swaggerOn) logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
