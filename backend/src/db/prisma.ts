import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export type Db = PrismaClient;

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: env.databaseUrl } },
      log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
    logger.info('prisma client initialised');
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
