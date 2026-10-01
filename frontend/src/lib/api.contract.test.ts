import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { api } from './api';

/**
 * Route contract test.
 *
 * Every path below was compared against the Express route definitions in
 * backend/src/routes/*.ts together with the mounts in backend/src/app.ts:
 *
 *   /api/health           -> '/', '/features'
 *   /api/meta             -> '/'
 *   /api/businesses       -> '/', '/recent', '/:businessId', '/:businessId/products'
 *   /api/conversations    -> '/', '/:conversationId', '/:conversationId/messages',
 *                            '/:conversationId/feedback',
 *                            '/business/:businessId', '/business/:businessId/:conversationId'
 *   /api/speech           -> '/', '/transcribe', '/speak'
 *   /api/account          -> '/profile', '/recent'
 *   /api/customer/orders  -> '/quote', '/', '/:orderId', '/:orderId/review'
 *   /api/merchant         -> '/businesses', '/businesses/:businessId',
 *                            '/businesses/:businessId/overview', '.../orders',
 *                            '.../orders/:orderId', '.../orders/:orderId/status',
 *                            '.../products', '.../products/:productId',
 *                            '.../products/import', '.../products/export',
 *                            '.../products/template', '.../reviews',
 *                            '.../conversations/counts'
 *
 * If a backend path is renamed, this test fails rather than the UI silently
 * calling a 404. These are mocked requests: no server is involved.
 */
const BASE = '/api';

interface Call {
  url: string;
  method: string;
}

let calls: Call[] = [];

function stubFetch(body: unknown = {}, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  calls = [];
  stubFetch({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function last(): Call {
  return calls[calls.length - 1];
}

describe('API client paths match the backend routes', () => {
  it('health and meta', async () => {
    await api.health.features();
    expect(last()).toEqual({ url: `${BASE}/health/features`, method: 'GET' });

    await api.meta();
    expect(last()).toEqual({ url: `${BASE}/meta`, method: 'GET' });
  });

  it('public business browsing', async () => {
    await api.businesses.list();
    expect(last()).toEqual({ url: `${BASE}/businesses`, method: 'GET' });

    await api.businesses.list({ search: 'saree', category: 'FASHION_TEXTILES' });
    expect(last().url).toBe(`${BASE}/businesses?search=saree&category=FASHION_TEXTILES`);

    await api.businesses.recent(['a', 'b']);
    expect(last().url).toBe(`${BASE}/businesses/recent?ids=a%2Cb`);

    await api.businesses.get('demo-sharma-kirana');
    expect(last()).toEqual({ url: `${BASE}/businesses/demo-sharma-kirana`, method: 'GET' });

    await api.businesses.products('demo-sharma-kirana', { search: 'atta' });
    expect(last().url).toBe(`${BASE}/businesses/demo-sharma-kirana/products?search=atta`);
  });

  it('conversations, including the merchant-scoped routes', async () => {
    await api.conversations.start('biz-1', 'bn');
    expect(last()).toEqual({ url: `${BASE}/conversations`, method: 'POST' });

    await api.conversations.get('c1', null);
    expect(last()).toEqual({ url: `${BASE}/conversations/c1`, method: 'GET' });

    await api.messages.send({
      conversationId: 'c1',
      guestToken: null,
      content: 'hi',
      locale: 'en',
      source: 'TEXT',
      cart: [],
    });
    expect(last()).toEqual({ url: `${BASE}/conversations/c1/messages`, method: 'POST' });

    await api.messages.feedback('c1', null, { rating: 5 });
    expect(last()).toEqual({ url: `${BASE}/conversations/c1/feedback`, method: 'POST' });

    // Merchant conversation routes are mounted under /conversations/business/...
    await api.merchantConversations.list('biz-1', 'OPEN');
    expect(last().url).toBe(`${BASE}/conversations/business/biz-1?status=OPEN`);

    await api.merchantConversations.get('biz-1', 'c1');
    expect(last()).toEqual({ url: `${BASE}/conversations/business/biz-1/c1`, method: 'GET' });

    await api.merchantConversations.setStatus('biz-1', 'c1', 'RESOLVED');
    expect(last()).toEqual({ url: `${BASE}/conversations/business/biz-1/c1`, method: 'PATCH' });
  });

  it('speech', async () => {
    await api.speech.speak('নমস্কার', 'bn');
    expect(last()).toEqual({ url: `${BASE}/speech/speak`, method: 'POST' });
  });

  it('account', async () => {
    await api.account.profile();
    expect(last()).toEqual({ url: `${BASE}/account/profile`, method: 'GET' });

    await api.account.update({ phone: '+91 98300 00000' });
    expect(last()).toEqual({ url: `${BASE}/account/profile`, method: 'PATCH' });

    await api.account.recent();
    expect(last()).toEqual({ url: `${BASE}/account/recent`, method: 'GET' });

    await api.account.recordRecent('biz-1');
    expect(last()).toEqual({ url: `${BASE}/account/recent`, method: 'POST' });
  });

  it('customer orders', async () => {
    await api.orders.quote('biz-1', [{ productId: 'p1', quantity: 2 }]);
    expect(last()).toEqual({ url: `${BASE}/customer/orders/quote`, method: 'POST' });

    await api.orders.create({
      businessId: 'biz-1',
      items: [{ productId: 'p1', quantity: 1 }],
      fulfillment: 'PICKUP',
      customerPhone: '+91 98300 00000',
      confirm: true,
    });
    expect(last()).toEqual({ url: `${BASE}/customer/orders`, method: 'POST' });

    await api.orders.list();
    expect(last()).toEqual({ url: `${BASE}/customer/orders`, method: 'GET' });

    await api.orders.get('o1');
    expect(last()).toEqual({ url: `${BASE}/customer/orders/o1`, method: 'GET' });

    await api.orders.review('o1', { rating: 5 });
    expect(last()).toEqual({ url: `${BASE}/customer/orders/o1/review`, method: 'POST' });
  });

  it('merchant business, orders and products', async () => {
    await api.merchant.createBusiness({
      name: 'Shop',
      category: 'GROCERY_DAILY_ESSENTIALS',
      ownerName: 'Owner',
      addressLine: '1 Road',
      city: 'Kolkata',
    });
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses`, method: 'POST' });

    await api.merchant.listBusinesses();
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses`, method: 'GET' });

    await api.merchant.getBusiness('biz-1');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1`, method: 'GET' });

    await api.merchant.updateBusiness('biz-1', { name: 'New' });
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1`, method: 'PATCH' });

    await api.merchant.overview('biz-1');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/overview`, method: 'GET' });

    await api.merchant.orders('biz-1', 'NEW');
    expect(last().url).toBe(`${BASE}/merchant/businesses/biz-1/orders?status=NEW`);

    await api.merchant.orders('biz-1', 'ALL');
    expect(last().url).toBe(`${BASE}/merchant/businesses/biz-1/orders`);

    // The merchant order route requires the business id in the path.
    await api.orders.getForMerchant('o1', 'biz-1');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/orders/o1`, method: 'GET' });

    await api.merchant.updateOrderStatus('biz-1', 'o1', 'ACCEPTED', 'ok');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/orders/o1/status`, method: 'PATCH' });

    await api.merchant.products('biz-1', { includeArchived: true });
    expect(last().url).toBe(`${BASE}/merchant/businesses/biz-1/products?includeArchived=true`);

    await api.merchant.createProduct('biz-1', { name: 'Atta', price: 265, availability: 'AVAILABLE' });
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/products`, method: 'POST' });

    await api.merchant.updateProduct('biz-1', 'p1', { availability: 'UNKNOWN' });
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/products/p1`, method: 'PATCH' });

    await api.merchant.archiveProduct('biz-1', 'p1');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/products/p1`, method: 'DELETE' });

    await api.merchant.reviews('biz-1');
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/reviews`, method: 'GET' });
  });

  it('import, export and template endpoints', async () => {
    const file = new File(['Name,Price,Availability'], 'products.csv', { type: 'text/csv' });

    await api.merchant.previewImport('biz-1', file);
    expect(last()).toEqual({ url: `${BASE}/merchant/businesses/biz-1/products/import`, method: 'POST' });

    await api.merchant.commitImport('biz-1', file);
    expect(last().url).toBe(`${BASE}/merchant/businesses/biz-1/products/import?mode=commit`);

    expect(api.merchant.downloadUrl('biz-1', 'template', 'xlsx')).toBe(
      `${BASE}/merchant/businesses/biz-1/products/template?format=xlsx`,
    );
    expect(api.merchant.downloadUrl('biz-1', 'export', 'csv')).toBe(
      `${BASE}/merchant/businesses/biz-1/products/export?format=csv`,
    );
  });
});

describe('API client error handling', () => {
  it('surfaces the backend error code and message', async () => {
    stubFetch({ error: { code: 'NOT_CONFIGURED', message: 'Sign-in is not configured.' } }, 503);
    await expect(api.account.profile()).rejects.toMatchObject({
      status: 503,
      code: 'NOT_CONFIGURED',
      message: 'Sign-in is not configured.',
    });
  });

  it('flags the Google sign-in requirement so the UI can route to checkout sign-in', async () => {
    stubFetch(
      { error: { code: 'GOOGLE_SIGN_IN_REQUIRED', message: 'Please sign in with Google to place an order.' } },
      403,
    );
    await expect(api.orders.list()).rejects.toMatchObject({ needsGoogleSignIn: true });
  });

  it('reports a network failure instead of throwing a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    await expect(api.meta()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
