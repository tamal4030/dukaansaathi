import { env, features, missingEnvFor } from './config/env';
import { logger } from './lib/logger';
import { getPrisma } from './db/prisma';
import { createApp } from './app';
import { createSupabaseVerifier } from './middleware/auth';
import { createDeepSeekClient } from './services/deepseek';
import { createSarvamClient, sarvamConfigFromEnv } from './services/sarvam';
import { createEmailSender } from './services/email';

async function main(): Promise<void> {
  if (!env.databaseUrl) {
    logger.error(
      'DATABASE_URL is not set. DukaanSaathi uses PostgreSQL as its only source of truth; refusing to start without it.',
      { missing: ['DATABASE_URL'], setup: 'See docs/DEPLOYMENT.md for the Supabase connection string.' },
    );
    process.exit(1);
  }

  const prisma = getPrisma();

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('database connection ok');
  } catch (error) {
    logger.error('could not reach the database. Check DATABASE_URL and that migrations were applied.', {
      reason: (error as Error).message,
    });
    process.exit(1);
  }

  // Report, do not hide, the integrations that still need credentials.
  const unavailable: Record<string, string[]> = {};
  for (const feature of ['supabaseAuth', 'assistant', 'speechToText', 'email'] as const) {
    if (!features[feature]()) unavailable[feature] = missingEnvFor(feature);
  }
  const speechKeys = sarvamConfigFromEnv(process.env as Record<string, string | undefined>).keyPool.length;
  logger.info('sarvam key pool ready', { configuredKeys: speechKeys });

  if (Object.keys(unavailable).length > 0) {
    logger.warn('some features are disabled because credentials are missing', { unavailable });
  } else {
    logger.info('all optional integrations are configured');
  }

  const deps = {
    prisma,
    verifier: createSupabaseVerifier(),
    chat: createDeepSeekClient({
      apiKey: env.deepseekApiKey,
      model: env.deepseekModel,
      timeoutMs: env.deepseekTimeoutMs,
    }),
    speech: createSarvamClient(sarvamConfigFromEnv(process.env as Record<string, string | undefined>)),
    email: createEmailSender(),
    frontendUrl: env.frontendUrl,
  };

  const app = createApp(deps);
  const server = app.listen(env.port, () => {
    logger.info('dukaansaathi api listening', { port: env.port, nodeEnv: env.nodeEnv });
  });

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('fatal startup error', { reason: (error as Error).message });
  process.exit(1);
});
