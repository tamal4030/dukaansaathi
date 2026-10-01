/**
 * Local HTTP integration harness.
 *
 * WHAT THIS PROVES
 *   The real Express app is booted on a real port and driven over real HTTP
 *   using the exact paths, methods and query strings that the frontend API
 *   client uses. This catches contract drift that mocked component tests cannot
 *   see: wrong paths, wrong status codes, and response shapes that do not match
 *   the frontend's TypeScript types.
 *
 * WHAT THIS DOES NOT PROVE
 *   There is no PostgreSQL. The app runs against the in-memory Prisma double
 *   from tests/fakePrisma.ts, which does not enforce unique constraints and
 *   does not roll back failed transactions. So this is NOT a database test, and
 *   NOT a substitute for running against real Supabase PostgreSQL.
 *
 *   No live provider call is made: the DeepSeek, Sarvam and Resend clients are
 *   stubs. Provider integration remains unverified.
 *
 * Run:  npx tsx tests/e2e.local.ts
 */
import { createApp } from '../src/app';
import { FakePrisma } from './fakePrisma';
import { AppError } from '../src/lib/errors';
import type { ChatClient, ChatMessage } from '../src/services/deepseek';
import type { SpeechClient } from '../src/services/sarvam';
import type { EmailMessage, EmailSender } from '../src/services/email';

const FRONTEND_URL = 'http://localhost:5173';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const message = detail ? `${label} -> ${detail}` : label;
    failures.push(message);
    console.log(`  FAIL  ${message}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------- test doubles

const sentEmails: EmailMessage[] = [];
let chatReply = JSON.stringify({ reply: 'We have atta at Rs 265.', language: 'en', proposed_items: [] });

const chat: ChatClient = {
  async complete(messages: ChatMessage[]) {
    return { content: chatReply };
  },
};

const speech: SpeechClient = {
  async transcribe() {
    return { transcript: 'do you have atta', languageCode: 'en-IN' };
  },
  async synthesize() {
    return { audioBase64: 'AAAA', mimeType: 'audio/wav' };
  },
};

const email: EmailSender = {
  async send(message) {
    sentEmails.push(message);
    return { status: 'SENT' };
  },
};

/** Test verifier: tokens look like `test:<sub>:<provider>:<email>`. */
const verifier = {
  async verify(token: string) {
    const [, sub, provider, address] = token.split(':');
    if (!sub) throw new AppError(401, 'UNAUTHORIZED', 'No subject.');
    return { sub, provider: provider || undefined, email: address || undefined };
  },
};

// ------------------------------------------------------------------- fixtures

function seed(prisma: FakePrisma) {
  const owner = prisma.seed('userProfile', [
    {
      id: 'profile-owner',
      authUserId: 'owner-1',
      email: 'owner@example.com',
      fullName: 'Rakesh Sharma',
      role: 'BUSINESS_OWNER',
      emailNotificationsOptIn: true,
    },
  ])[0];

  const customer = prisma.seed('userProfile', [
    {
      id: 'profile-customer',
      authUserId: 'cust-1',
      email: 'anita@example.com',
      fullName: 'Anita Roy',
      role: 'CUSTOMER',
      emailNotificationsOptIn: true,
    },
  ])[0];

  const business = prisma.seed('business', [
    {
      id: 'biz-0001',
      ownerId: owner.id,
      name: 'Sharma Kirana & General Store',
      slug: 'demo-sharma-kirana',
      category: 'GROCERY_DAILY_ESSENTIALS',
      description: 'Neighbourhood kirana shop',
      addressLine: '14 Bidhan Sarani',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700006',
      publicPhone: '+91 98300 11223',
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryNotes: 'Free delivery above Rs 300',
      paymentMethods: ['Cash on delivery'],
      returnPolicy: 'Sealed packets within 2 days',
      isActive: true,
      isPublic: true,
      emailNotificationsOptIn: true,
      emailNotificationsEmail: 'shop@example.com',
      searchText: 'sharma kirana kolkata grocery',
    },
  ])[0];

  prisma.seed('businessMember', [{ businessId: business.id, userId: owner.id, role: 'OWNER' }]);
  prisma.seed('businessHour', [
    { businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '07:00', closeTime: '21:30' },
  ]);
  prisma.seed('businessFaq', [
    { businessId: business.id, question: 'Do you deliver?', answer: 'Yes, free above Rs 300.', sortOrder: 0 },
  ]);

  const products = [
    { name: 'Aashirvaad Atta 5kg', price: '265.00', availability: 'AVAILABLE', aliases: ['atta', 'aata'] },
    { name: 'Amul Taaza Milk 500ml', price: '28.00', availability: 'OUT_OF_STOCK', aliases: ['milk'] },
    { name: 'Gobindobhog Rice 1kg', price: '95.00', availability: 'UNKNOWN', aliases: ['chal'] },
  ].map((product, index) =>
    prisma.seed('product', [
      {
        id: `biz-0001-product-${index + 1}`,
        businessId: business.id,
        name: product.name,
        price: product.price,
        availability: product.availability,
        aliases: product.aliases,
        isArchived: false,
      },
    ])[0],
  );

  return { owner, customer, business, products };
}

// ----------------------------------------------------------------------- main

async function main() {
  const prisma = new FakePrisma();
  seed(prisma);

  const app = createApp(
    { prisma, chat, speech, email, verifier, frontendUrl: FRONTEND_URL },
    { allowAllOrigins: true },
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the port.');
  const base = `http://127.0.0.1:${address.port}`;
  console.log(`Real Express server listening on ${base}`);
  console.log('Database: in-memory Prisma double (NOT PostgreSQL)');
  console.log('Providers: stubbed (no live DeepSeek/Sarvam/Resend calls)');

  async function call(
    path: string,
    init: { method?: string; token?: string; guestToken?: string; body?: unknown } = {},
  ) {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.guestToken) headers['X-Guest-Token'] = init.guestToken;
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  }

  // ---------------------------------------------------------------- health
  section('Health and capabilities');
  {
    const health = await call('/api/health');
    check('GET /api/health returns ok', health.status === 200 && health.body.status === 'ok');

    const features = await call('/api/health/features');
    check('GET /api/health/features reports capability flags', features.status === 200 && typeof features.body.assistant === 'boolean');
  }

  // ------------------------------------------------------- guest browsing
  section('Guest browsing (no account)');
  {
    const list = await call('/api/businesses');
    check('GET /api/businesses lists the shop without auth', list.status === 200 && list.body.businesses.length === 1);
    check('business card has the fields the UI renders',
      Boolean(list.body.businesses[0].name && list.body.businesses[0].categoryLabel && list.body.businesses[0].openState));
    check('public payload hides the private notification email',
      !JSON.stringify(list.body).includes('shop@example.com'));

    const detail = await call('/api/businesses/demo-sharma-kirana');
    check('GET /api/businesses/:slug resolves by slug', detail.status === 200 && detail.body.business.id === 'biz-0001');
    check('detail includes hours and FAQs', detail.body.business.hours.length === 1 && detail.body.business.faqs.length === 1);

    const products = await call('/api/businesses/demo-sharma-kirana/products');
    check('GET products returns the catalogue', products.status === 200 && products.body.products.length === 3);

    const searched = await call('/api/businesses/demo-sharma-kirana/products?search=milk');
    check('product search matches', searched.body.products.length === 1);
    check('out-of-stock is labelled honestly', searched.body.products[0].availabilityLabel === 'Out of stock');

    const unknown = await call('/api/businesses/demo-sharma-kirana/products?search=chal');
    check('UNKNOWN is never reported as Available',
      unknown.body.products[0].availability === 'UNKNOWN' && unknown.body.products[0].availabilityLabel !== 'Available');

    const recent = await call('/api/businesses/recent?ids=biz-0001');
    check('recently-accessed lookup works', recent.status === 200 && recent.body.businesses.length === 1);

    const meta = await call('/api/meta');
    check('GET /api/meta supplies the 7 categories and review tags',
      meta.body.categories.length === 7 && meta.body.reviewTags.length === 5);
  }

  // -------------------------------------------------------- guest chat
  section('Guest chat bound to one business');
  let conversationId = '';
  let guestToken = '';
  {
    const created = await call('/api/conversations', { method: 'POST', body: { businessId: 'biz-0001', locale: 'en' } });
    check('POST /api/conversations creates a guest conversation', created.status === 201);
    conversationId = created.body.conversation.id;
    guestToken = created.body.guestToken;
    check('server issues an unguessable guest token', typeof guestToken === 'string' && guestToken.length > 20);

    const noToken = await call(`/api/conversations/${conversationId}`);
    check('conversation is unreadable without the guest token', noToken.status === 403);

    const withToken = await call(`/api/conversations/${conversationId}`, { guestToken });
    check('conversation is readable with the guest token', withToken.status === 200);

    chatReply = JSON.stringify({
      reply: 'Yes, Aashirvaad Atta 5kg is Rs 265 and available.',
      language: 'en',
      proposed_items: [{ product_id: 'biz-0001-product-1', quantity: 2 }],
    });
    const message = await call(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      guestToken,
      body: { content: 'do you have atta?', locale: 'en', source: 'TEXT', cart: [] },
    });
    check('POST message returns customer and assistant turns', message.status === 201 && message.body.messages.length === 2);
    check('assistant reply is stored and returned', typeof message.body.assistant.reply === 'string' && message.body.assistant.available === true);
    check('proposal is validated against the database and priced server-side',
      message.body.assistant.proposals.length === 1 && message.body.assistant.proposals[0].unitPrice === '265.00');

    chatReply = JSON.stringify({
      reply: 'Your order has been placed and payment has been received.',
      language: 'en',
      proposed_items: [],
    });
    const guarded = await call(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      guestToken,
      body: { content: 'place my order', locale: 'en', source: 'TEXT', cart: [] },
    });
    check('a false "order placed" claim is rewritten', guarded.body.assistant.reply.includes('I have not placed any order'));
    check('a false payment claim is rewritten', guarded.body.assistant.reply.includes('cannot confirm any payment'));
    check('no order was created by the model', prisma.tables.order.length === 0);

    const feedback = await call(`/api/conversations/${conversationId}/feedback`, {
      method: 'POST',
      guestToken,
      body: { rating: 5, comment: 'Helpful' },
    });
    check('guest feedback is accepted', feedback.status === 201);
  }

  // ------------------------------------------------------------- ordering
  section('Ordering: server-side pricing and the sign-in gate');
  let orderId = '';
  {
    const quote = await call('/api/customer/orders/quote', {
      method: 'POST',
      body: { businessId: 'biz-0001', items: [{ productId: 'biz-0001-product-1', quantity: 2, unitPrice: '0.01' }] },
    });
    check('quote prices from the database, ignoring a client-supplied price',
      quote.body.quote.lines[0].unitPrice === '265.00' && quote.body.quote.total === '530.00');

    const unknownQuote = await call('/api/customer/orders/quote', {
      method: 'POST',
      body: { businessId: 'biz-0001', items: [{ productId: 'biz-0001-product-3', quantity: 1 }] },
    });
    check('UNKNOWN availability cannot be submitted', unknownQuote.body.quote.canSubmit === false);

    const anonymous = await call('/api/customer/orders', {
      method: 'POST',
      body: { businessId: 'biz-0001', items: [{ productId: 'biz-0001-product-1', quantity: 1 }], fulfillment: 'PICKUP', customerPhone: '+91 98300 00011', confirm: true },
    });
    check('anonymous order is rejected with 401', anonymous.status === 401);

    const emailOnly = await call('/api/customer/orders', {
      method: 'POST',
      token: 'test:cust-1:email:anita@example.com',
      body: { businessId: 'biz-0001', items: [{ productId: 'biz-0001-product-1', quantity: 1 }], fulfillment: 'PICKUP', customerPhone: '+91 98300 00011', confirm: true },
    });
    check('email/password customer is blocked with GOOGLE_SIGN_IN_REQUIRED',
      emailOnly.status === 403 && emailOnly.body.error.code === 'GOOGLE_SIGN_IN_REQUIRED');

    const unconfirmed = await call('/api/customer/orders', {
      method: 'POST',
      token: 'test:cust-1:google:anita@example.com',
      body: { businessId: 'biz-0001', items: [{ productId: 'biz-0001-product-1', quantity: 1 }], fulfillment: 'PICKUP', customerPhone: '+91 98300 00011' },
    });
    check('order without explicit confirmation is rejected', unconfirmed.status === 400);

    const created = await call('/api/customer/orders', {
      method: 'POST',
      token: 'test:cust-1:google:anita@example.com',
      body: {
        businessId: 'biz-0001',
        items: [{ productId: 'biz-0001-product-1', quantity: 2 }],
        fulfillment: 'PICKUP',
        customerPhone: '+91 98300 00011',
        confirm: true,
      },
    });
    check('Google customer can place an order', created.status === 201);
    orderId = created.body.order?.id;
    check('order total is computed by the backend', created.body.order.total === '530.00');
    check('order records a status history entry', created.body.order.statusHistory.length === 1);
    check('business was emailed because it opted in', sentEmails.length === 1 && sentEmails[0].to === 'shop@example.com');
    check('notification outcome is reported honestly', created.body.notifications.businessEmail === 'SENT');
  }

  // --------------------------------------------------- business dashboard
  section('Business login, protected data and tenant isolation');
  {
    const unauthenticated = await call('/api/merchant/businesses/biz-0001/orders');
    check('merchant orders require a token', unauthenticated.status === 401);

    const token = 'test:owner-1:email:owner@example.com';
    const mine = await call('/api/merchant/businesses', { token });
    check('owner sees their business', mine.status === 200 && mine.body.businesses.length === 1);

    const orders = await call('/api/merchant/businesses/biz-0001/orders', { token });
    check('owner sees their orders', orders.status === 200 && orders.body.orders.length === 1);

    const overview = await call('/api/merchant/businesses/biz-0001/overview', { token });
    check('overview reports needs-attention from the database', overview.status === 200 && overview.body.needsAttention.newOrders === 1);
    check('overview reports no top products before any completion', overview.body.topProducts.length === 0);

    // A second, unrelated business owned by someone else.
    prisma.seed('business', [
      { id: 'biz-0002', ownerId: 'other', name: 'Ritu Sarees', slug: 'ritu', category: 'FASHION_TEXTILES', isActive: true, isPublic: true },
    ]);
    const foreign = await call('/api/merchant/businesses/biz-0002/orders', { token });
    check('owner cannot read another business (404, not 403)', foreign.status === 404);
    check('the foreign business is not confirmed to exist', foreign.body.error.code === 'NOT_FOUND');
  }

  // ------------------------------------------------------- status updates
  section('Order status updates and customer history');
  {
    const token = 'test:owner-1:email:owner@example.com';
    const customer = 'test:cust-1:google:anita@example.com';

    const illegal = await call(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`, {
      method: 'PATCH',
      token,
      body: { status: 'COMPLETED' },
    });
    check('skipping steps is rejected (NEW -> COMPLETED)', illegal.status === 409);

    for (const status of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED']) {
      const step = await call(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`, {
        method: 'PATCH',
        token,
        body: { status },
      });
      check(`status advances to ${status}`, step.status === 200 && step.body.order.status === status);
    }

    const detail = await call(`/api/customer/orders/${orderId}`, { token: customer });
    check('customer sees the updated status', detail.body.order.status === 'COMPLETED');
    check('status history is append-only and complete', detail.body.order.statusHistory.length === 5);
    check('completed order becomes reviewable', detail.body.order.canReview === true);

    const review = await call(`/api/customer/orders/${orderId}/review`, {
      method: 'POST',
      token: customer,
      body: { rating: 5, comment: 'Fresh stock, quick delivery', tags: ['PRODUCT_QUALITY', 'VALUE'] },
    });
    check('completed order can be reviewed', review.status === 201);

    const duplicate = await call(`/api/customer/orders/${orderId}/review`, {
      method: 'POST',
      token: customer,
      body: { rating: 1 },
    });
    check('duplicate review is rejected', duplicate.status === 409);
  }

  // ----------------------------------------------------------- products
  section('Product import, export and template');
  {
    const token = 'test:owner-1:email:owner@example.com';
    const csv = [
      'Name,Price,Availability,Description,Category,Alternate names',
      'Sugar 1kg,45,Available,Refined sugar,Grocery,"chini, sugar"',
      'Mystery Item,10,,No stock status given,,',
    ].join('\n');

    const preview = await fetch(`${base}/api/merchant/businesses/biz-0001/products/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
        return form;
      })(),
    });
    const previewBody = (await preview.json()) as any;
    check('CSV import previews without saving', preview.status === 200 && previewBody.mode === 'preview');
    check('preview reports valid rows', previewBody.validRows === 2);
    check('blank availability becomes UNKNOWN, never AVAILABLE',
      previewBody.rows.find((r: any) => r.name === 'Mystery Item').availability === 'UNKNOWN');

    const before = prisma.tables.product.length;
    const commit = await fetch(`${base}/api/merchant/businesses/biz-0001/products/import?mode=commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
        return form;
      })(),
    });
    const commitBody = (await commit.json()) as any;
    check('commit saves the validated rows', commit.status === 201 && commitBody.created === 2);
    check('catalogue grew by exactly two', prisma.tables.product.length === before + 2);

    const badCsv = ['Name,Price,Availability', ',50,Available', 'Broken,abc,Available'].join('\n');
    const bad = await fetch(`${base}/api/merchant/businesses/biz-0001/products/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: (() => {
        const form = new FormData();
        form.append('file', new Blob([badCsv], { type: 'text/csv' }), 'bad.csv');
        return form;
      })(),
    });
    const badBody = (await bad.json()) as any;
    check('invalid rows produce row-level errors', badBody.canCommit === false && badBody.issues.length >= 2);
    check('errors name the row and column', badBody.issues[0].row >= 2 && typeof badBody.issues[0].column === 'string');

    // The template is a CSV download, not JSON, so read it as text.
    const templateResponse = await fetch(`${base}/api/merchant/businesses/biz-0001/products/template?format=csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const templateText = await templateResponse.text();
    check('CSV template is served with the documented columns',
      templateResponse.status === 200 &&
        templateText.startsWith('Name,Price,Availability,Description,Category,Alternate names'));

    const exportResponse = await fetch(`${base}/api/merchant/businesses/biz-0001/products/export?format=csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const exportText = await exportResponse.text();
    check('CSV export contains the catalogue',
      exportResponse.status === 200 && exportText.includes('Aashirvaad Atta 5kg'));
    check('CSV export writes availability as a re-importable label',
      exportText.includes('Availability unknown'));
  }

  // -------------------------------------------------------------- speech
  section('Speech endpoints (stubbed provider)');
  {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('fake-audio')], { type: 'audio/webm' }), 'recording.webm');
    form.append('language', 'bn');
    const stt = await fetch(`${base}/api/speech/transcribe`, { method: 'POST', body: form });
    const sttBody = (await stt.json()) as any;
    check('POST /api/speech/transcribe returns a transcript', stt.status === 200 && typeof sttBody.transcript === 'string');
    check('requested language is forwarded to the provider', sttBody.requestedLanguage === 'bn');

    const tts = await call('/api/speech/speak', { method: 'POST', body: { text: 'নমস্কার', language: 'bn' } });
    check('POST /api/speech/speak returns audio', tts.status === 200 && typeof tts.body.audioBase64 === 'string');

    const englishTts = await call('/api/speech/speak', { method: 'POST', body: { text: 'Hello', language: 'en' } });
    check('English playback is delegated to the browser voice', englishTts.status === 400 && englishTts.body.error.code === 'USE_BROWSER_VOICE');
  }

  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log('Database: in-memory double. Providers: stubbed.');
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((failure) => console.log(`  - ${failure}`));
  }
  // Exit explicitly: undici keeps sockets alive and would otherwise hold the
  // process open indefinitely.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
