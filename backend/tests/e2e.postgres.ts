/**
 * REAL end-to-end HTTP test against REAL PostgreSQL (Supabase).
 *
 * Difference from tests/e2e.local.ts:
 *   - Boots the real Express app on a real port (both do that).
 *   - Uses the REAL PrismaClient against the configured Supabase database,
 *     so unique constraints, transactions and indexes are genuinely exercised.
 *   - Calls the REAL DeepSeek and Sarvam APIs for the assistant and speech
 *     checks (two small calls), so those integrations are genuinely exercised.
 *
 * It seeds its own throwaway business with a unique slug prefix and removes it
 * afterwards, so demo data is untouched.
 *
 * Run:  npx tsx tests/e2e.postgres.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { createDeepSeekClient } from '../src/services/deepseek';
import { createSarvamClient, sarvamConfigFromEnv } from '../src/services/sarvam';
import { createEmailSender } from '../src/services/email';
import { AppError } from '../src/lib/errors';

const env = process.env as Record<string, string | undefined>;
const PREFIX = 'e2e-check';
const SLUG = `${PREFIX}-shop`;
const AUTH_OWNER = `${PREFIX}-owner`;
const AUTH_CUSTOMER = `${PREFIX}-customer`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(detail ? `${label} -> ${detail}` : label);
    console.log(`  FAIL  ${detail ? `${label} -> ${detail}` : label}`);
  }
}
const section = (t: string) => console.log(`\n=== ${t} ===`);

const prisma = new PrismaClient();

const verifier = {
  async verify(token: string) {
    const [, sub, provider, address] = token.split(':');
    if (!sub) throw new AppError(401, 'UNAUTHORIZED', 'No subject.');
    return { sub, provider: provider || undefined, email: address || undefined };
  },
};

const OWNER_TOKEN = `test:${AUTH_OWNER}:email:owner@e2e.invalid`;
const CUSTOMER_TOKEN = `test:${AUTH_CUSTOMER}:google:customer@e2e.invalid`;

async function cleanup() {
  const businesses = await prisma.business.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  if (ids.length) {
    await prisma.order.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.userProfile.deleteMany({ where: { authUserId: { startsWith: PREFIX } } });
}

async function seed() {
  const owner = await prisma.userProfile.create({
    data: {
      authUserId: AUTH_OWNER,
      email: 'owner@e2e.invalid',
      fullName: 'E2E Owner',
      role: 'BUSINESS_OWNER',
      emailNotificationsOptIn: true,
    },
  });
  const customer = await prisma.userProfile.create({
    data: {
      authUserId: AUTH_CUSTOMER,
      email: 'customer@e2e.invalid',
      fullName: 'E2E Customer',
      role: 'CUSTOMER',
      emailNotificationsOptIn: false,
    },
  });
  const business = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: 'E2E Check Shop',
      slug: SLUG,
      category: 'GROCERY_DAILY_ESSENTIALS',
      addressLine: '1 Test Road',
      city: 'Kolkata',
      publicPhone: '+91 90000 00000',
      pickupEnabled: true,
      deliveryEnabled: true,
      isActive: true,
      isPublic: true,
      emailNotificationsOptIn: true,
      emailNotificationsEmail: 'shop@e2e.invalid',
      searchText: 'e2e check shop kolkata grocery',
      members: { create: { userId: owner.id, role: 'OWNER' } },
      hours: { create: [{ dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00' }] },
      faqs: { create: [{ question: 'Do you deliver?', answer: 'Yes, above Rs 300.', sortOrder: 0 }] },
    },
  });
  const products = await Promise.all(
    [
      { name: 'E2E Atta 5kg', price: '265.00', availability: 'AVAILABLE' as const, aliases: ['atta'] },
      { name: 'E2E Milk 500ml', price: '28.00', availability: 'OUT_OF_STOCK' as const, aliases: ['milk'] },
      { name: 'E2E Rice 1kg', price: '95.00', availability: 'UNKNOWN' as const, aliases: ['chal'] },
    ].map((p) =>
      prisma.product.create({ data: { ...p, businessId: business.id, searchText: p.name.toLowerCase() } }),
    ),
  );
  return { owner, customer, business, products };
}

async function main() {
  console.log('REAL end-to-end test: real Express server + REAL PostgreSQL + REAL providers');
  console.log('Database host:', (env.DIRECT_URL ?? '').split('@')[1]?.split('/')[0] ?? 'unknown');

  await cleanup();
  const { business, products } = await seed();

  const app = createApp({
    prisma,
    verifier,
    chat: createDeepSeekClient({
      apiKey: (env.DEEPSEEK_API_KEY ?? '').trim(),
      model: (env.DEEPSEEK_MODEL ?? '').trim(),
      timeoutMs: 45000,
    }),
    speech: createSarvamClient(sarvamConfigFromEnv(env)),
    email: createEmailSender(),
    frontendUrl: 'http://localhost:5173',
  });

  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${addr.port}`;

  async function call(path: string, init: { method?: string; token?: string; guestToken?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.guestToken) headers['X-Guest-Token'] = init.guestToken;
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  // ------------------------------------------------------------ real DB
  section('Public browsing against real PostgreSQL');
  {
    const list = await call('/api/businesses?search=E2E');
    check('directory returns the seeded shop', list.status === 200 && list.body.businesses.some((b: any) => b.slug === SLUG));

    const detail = await call(`/api/businesses/${SLUG}`);
    check('detail resolves by slug', detail.status === 200 && detail.body.business.id === business.id);
    check('hours and FAQs load from the database', detail.body.business.hours.length === 1 && detail.body.business.faqs.length === 1);

    const prods = await call(`/api/businesses/${SLUG}/products`);
    check('catalogue loads from the database', prods.body.products.length === 3);
    const unknown = prods.body.products.find((p: any) => p.name.includes('Rice'));
    check('UNKNOWN availability is preserved end to end', unknown.availability === 'UNKNOWN' && unknown.availabilityLabel !== 'Available');
  }

  section('Order creation with a REAL transaction and REAL unique constraint');
  let orderId = '';
  {
    const quote = await call('/api/customer/orders/quote', {
      method: 'POST',
      body: { businessId: business.id, items: [{ productId: products[0].id, quantity: 2 }] },
    });
    check('quote prices from real database rows', quote.body.quote.total === '530.00');

    const created = await call('/api/customer/orders', {
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: {
        businessId: business.id,
        items: [{ productId: products[0].id, quantity: 2 }],
        fulfillment: 'PICKUP',
        customerPhone: '+91 90000 00001',
        confirm: true,
      },
    });
    check('order is created in a real transaction', created.status === 201);
    orderId = created.body.order?.id;
    check('order total computed server-side', created.body.order.total === '530.00');

    // Verify the rows really exist in PostgreSQL.
    const dbOrder = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, statusEvents: true } });
    check('order row persisted in PostgreSQL', dbOrder !== null);
    check('price snapshot persisted', dbOrder?.items[0]?.unitPriceSnapshot.toString() === '265');
    check('initial status event persisted', dbOrder?.statusEvents.length === 1);

    // Prove the UNIQUE constraint on orderCode is real.
    let constraintHeld = false;
    try {
      await prisma.order.create({
        data: {
          orderCode: dbOrder!.orderCode,
          businessId: business.id,
          customerId: dbOrder!.customerId,
          fulfillment: 'PICKUP',
          customerName: 'dup',
          subtotal: new Prisma.Decimal(1),
          total: new Prisma.Decimal(1),
        },
      });
    } catch (error) {
      constraintHeld = (error as { code?: string }).code === 'P2002';
    }
    check('Order.orderCode UNIQUE constraint is enforced by PostgreSQL', constraintHeld);
  }

  section('Status lifecycle and duplicate-review constraint in PostgreSQL');
  {
    for (const status of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED']) {
      const step = await call(`/api/merchant/businesses/${business.id}/orders/${orderId}/status`, {
        method: 'PATCH',
        token: OWNER_TOKEN,
        body: { status },
      });
      check(`status -> ${status}`, step.status === 200 && step.body.order.status === status);
    }
    const dbOrder = await prisma.order.findUnique({ where: { id: orderId }, include: { statusEvents: true } });
    check('status history rows persisted (5 events)', dbOrder?.statusEvents.length === 5);

    const review = await call(`/api/customer/orders/${orderId}/review`, {
      method: 'POST',
      token: CUSTOMER_TOKEN,
      body: { rating: 5, comment: 'Real DB review', tags: ['PRODUCT_VALUE' in {} ? 'VALUE' : 'VALUE'] },
    });
    check('review created', review.status === 201);

    // Prove the one-review-per-order constraint.
    let reviewConstraintHeld = false;
    try {
      await prisma.orderReview.create({
        data: { orderId, businessId: business.id, customerId: dbOrder!.customerId, rating: 1, tags: [] },
      });
    } catch (error) {
      reviewConstraintHeld = (error as { code?: string }).code === 'P2002';
    }
    check('OrderReview.orderId UNIQUE constraint enforced (one review per order)', reviewConstraintHeld);

    const overview = await call(`/api/merchant/businesses/${business.id}/overview`, { token: OWNER_TOKEN });
    check('overview aggregates real completed orders', overview.status === 200 && overview.body.completedOrders === 1);
    check('top products computed from completed orders', overview.body.topProducts.length > 0 && overview.body.topProducts[0].quantitySold === 2);
  }

  section('Tenant isolation against real data');
  {
    const other = await prisma.business.findFirst({ where: { slug: { startsWith: 'demo-' } }, select: { id: true } });
    if (other) {
      const foreign = await call(`/api/merchant/businesses/${other.id}/orders`, { token: OWNER_TOKEN });
      check('owner cannot read a different business (404)', foreign.status === 404);
    } else {
      check('demo business available for isolation check', false, 'no demo business found');
    }
  }

  // --------------------------------------------------- real providers
  section('Assistant against REAL DeepSeek (one call)');
  {
    const created = await call('/api/conversations', { method: 'POST', body: { businessId: business.id, locale: 'en' } });
    const conversationId = created.body.conversation.id;
    const guestToken = created.body.guestToken;
    check('guest conversation created', created.status === 201);

    const message = await call(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      guestToken,
      body: { content: 'Do you have atta and what does it cost?', locale: 'en', source: 'TEXT', cart: [] },
    });

    if (message.status !== 201) {
      check('assistant replied', false, `HTTP ${message.status}`);
    } else {
      check('assistant replied over the real API', message.body.assistant.available === true);
      const reply = String(message.body.assistant.reply ?? '');
      console.log(`      reply: ${JSON.stringify(reply.slice(0, 200))}`);
      check('assistant reply is non-empty', reply.trim().length > 0);
      check('assistant used the real price from the database', reply.includes('265'));
      check('assistant did not claim an order was placed', !/order (has been|is) (placed|confirmed)/i.test(reply));

      const dbMessages = await prisma.message.findMany({ where: { conversationId } });
      check('both turns persisted in PostgreSQL', dbMessages.length === 2);

      // The ambiguous/absent-data rule: ask about something the shop does not sell.
      const missing = await call(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        guestToken,
        body: { content: 'Do you sell washing machines?', locale: 'en', source: 'TEXT', cart: [] },
      });
      const missingReply = String(missing.body?.assistant?.reply ?? '');
      console.log(`      reply: ${JSON.stringify(missingReply.slice(0, 200))}`);

      // The assistant must express uncertainty and must not assert that the
      // product exists. Checking for negation words is too brittle, so assert
      // the two things that actually matter: it says it could not find/confirm
      // it, and it does not claim the item is stocked or priced.
      const expressesUncertainty =
        /could ?n[o']t find|couldn't find|cannot find|do(?:es)? not (?:have|sell|stock)|not (?:available|stocked|in (?:our|the) catalog)|no .{0,20}(?:match|record|listing)|unable to find|don't have|do not have/i.test(
          missingReply,
        );
      const inventsStock = /\byes\b.{0,40}washing machine|washing machine.{0,30}(?:is|are)\s+(?:available|in stock)|Rs\s?\d+.{0,20}washing machine/i.test(
        missingReply,
      );
      check('assistant expresses uncertainty about an unstocked product', expressesUncertainty, missingReply.slice(0, 160));
      check('assistant does not claim the unstocked product exists', !inventsStock, missingReply.slice(0, 160));
    }
  }

  section('Speech against REAL Sarvam');
  {
    const tts = await call('/api/speech/speak', { method: 'POST', body: { text: 'নমস্কার, আমরা খোলা আছি।', language: 'bn' } });
    check('Sarvam TTS returns real audio', tts.status === 200 && typeof tts.body.audioBase64 === 'string' && tts.body.audioBase64.length > 1000);
  }

  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${'='.repeat(64)}`);
  console.log(`REAL E2E RESULT: ${passed} passed, ${failed} failed`);
  console.log('Database: REAL PostgreSQL (Supabase). Providers: REAL DeepSeek + Sarvam.');
  if (failed) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error('Harness error:', error);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
