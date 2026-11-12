import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isCrossSiteWrite } from './common/csrf.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  if (process.env.NODE_ENV === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      // The dev example's published values and the old module fallback are as unusable as the CHANGE_ME placeholder.
      if (!process.env[k] || /^(CHANGE_ME|vapt-(access|refresh)-secret|default-secret)/.test(process.env[k]!)) {
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

  // Client IP for per-IP rate limits and the audit log. The frontend container appends the address of the peer that
  // connected to it (apps/frontend/forwarded-for.js), so exactly one hop is trusted by default and everything to the left
  // of it is client-supplied and ignored. Behind one more reverse proxy / tunnel that also appends (nginx, Cloudflare),
  // set TRUST_PROXY_HOPS=2 so the real client, not the proxy, is the one rate-limited. Counting hops, not address ranges,
  // is what keeps a private-network client from being mistaken for a proxy and a forged header from winning.
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);

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

  // CSRF defence in depth (cookies are already SameSite=strict): refuse browser-flagged cross-site writes.
  const appOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.use((req: any, res: any, next: () => void) => {
    if (isCrossSiteWrite(req.method, req.headers, appOrigin)) {
      res.status(403).json({ statusCode: 403, message: 'Cross-site request blocked' });
      return;
    }
    next();
  });

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
  // Bound slow-request exposure (uploads are capped at 25 MB, Nessus scans at 500 MB, which a slow link needs minutes
  // to send; report generation runs in a queue).
  server.requestTimeout = 15 * 60_000;
  server.headersTimeout = 30_000;
  logger.log(`VAPT Command Center API running on port ${port}`);
  if (swaggerOn) logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
