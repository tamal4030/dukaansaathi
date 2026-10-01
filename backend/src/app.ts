import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import type { Db } from './db/prisma';
import { env } from './config/env';
import { AppError } from './lib/errors';
import { errorHandler, notFoundHandler } from './middleware/error';
import { createAuthMiddleware, type AuthVerifier } from './middleware/auth';
import { healthRouter } from './routes/health';
import { metaRouter } from './routes/meta';
import { publicBusinessRouter } from './routes/publicBusinesses';
import { conversationRouter } from './routes/conversations';
import { speechRouter } from './routes/speech';
import { accountRouter } from './routes/account';
import { customerOrderRouter } from './routes/customerOrders';
import { merchantRouter } from './routes/merchant';
import type { ChatClient } from './services/deepseek';
import type { SpeechClient } from './services/sarvam';
import type { EmailSender } from './services/email';

export interface AppDeps {
  prisma: Db;
  chat: ChatClient;
  speech: SpeechClient;
  email: EmailSender;
  verifier: AuthVerifier;
  frontendUrl: string;
}

export interface AppOptions {
  /** Disable CORS origin checking (used by tests). */
  allowAllOrigins?: boolean;
}

export function buildCorsOptions(allowAllOrigins = false): CorsOptions {
  const allowed = new Set(
    [...env.corsAllowedOrigins, env.frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean),
  );
  return {
    origin(origin, callback) {
      if (allowAllOrigins || !origin) {
        callback(null, true);
        return;
      }
      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(
        new AppError(
          403,
          'CORS_BLOCKED',
          `The origin ${origin} is not allowed. Add it to CORS_ALLOWED_ORIGINS on the backend.`,
        ),
      );
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  };
}

export function createApp(deps: AppDeps, options: AppOptions = {}): Express {
  const app = express();

  // Render terminates TLS in front of the service.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors(buildCorsOptions(options.allowAllOrigins)));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  const auth = createAuthMiddleware({ prisma: deps.prisma, verifier: deps.verifier });

  app.use('/api/health', healthRouter());
  app.use('/api/meta', metaRouter());
  app.use('/api/businesses', publicBusinessRouter(deps));
  app.use('/api/conversations', conversationRouter(deps, auth));
  app.use('/api/speech', speechRouter(deps, auth));
  app.use('/api/account', accountRouter(deps, auth));
  app.use('/api/customer/orders', customerOrderRouter(deps, auth));
  app.use('/api/merchant', merchantRouter(deps, auth));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
