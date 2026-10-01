/**
 * Base seed: checks the database connection and prints what is present.
 * It deliberately does NOT invent credentials. Sample catalogues live in
 * prisma/demo-seed.ts (npm run db:demo).
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_BUSINESSES } from './demoData';

const prisma = new PrismaClient();

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  const [businesses, products, orders, conversations] = await Promise.all([
    prisma.business.count(),
    prisma.product.count(),
    prisma.order.count(),
    prisma.conversation.count(),
  ]);

  console.log('DukaanSaathi seed check');
  console.log(`  database reachable: yes`);
  console.log(`  businesses: ${businesses}`);
  console.log(`  products:   ${products}`);
  console.log(`  orders:     ${orders}`);
  console.log(`  conversations: ${conversations}`);

  if (businesses === 0) {
    console.log('');
    console.log('No businesses yet. Create your own through the app, or load the sample catalogue:');
    console.log('  npm run db:demo');
    console.log(`  (${DEMO_BUSINESSES.length} clearly marked sample businesses across all 7 categories)`);
  } else {
    console.log('');
    console.log('Run `npm run db:demo` to add clearly marked sample businesses across all 7 categories.');
  }
}

main()
  .catch((error) => {
    console.error('Seed check failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
