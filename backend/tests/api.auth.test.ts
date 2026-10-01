import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, buildTestApp, seedBusiness, seedCustomer, testToken, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(() => {
  ctx = buildTestApp();
});

describe('authentication and tenant isolation (acceptance 2 and 3)', () => {
  it('requires a token for customer order history', async () => {
    const response = await request(ctx.app).get('/api/customer/orders').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires a token for merchant endpoints', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    const response = await request(ctx.app).get('/api/merchant/businesses/biz-0001/orders').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a business owner reading another business private data', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });

    const token = testToken({ sub: 'owner-2', email: 'owner-2@example.com' });
    // owner-2 must not see biz-1, and must not learn that it exists.
    const orders = await request(ctx.app).get('/api/merchant/businesses/biz-0001/orders').set(authHeader(token)).expect(404);
    expect(orders.body.error.code).toBe('NOT_FOUND');

    const overview = await request(ctx.app).get('/api/merchant/businesses/biz-0001/overview').set(authHeader(token)).expect(404);
    expect(overview.body.error.code).toBe('NOT_FOUND');

    const products = await request(ctx.app).get('/api/merchant/businesses/biz-0001/products').set(authHeader(token)).expect(404);
    expect(products.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a business owner modifying another business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    const token = testToken({ sub: 'owner-2' });

    await request(ctx.app)
      .patch('/api/merchant/businesses/biz-0001')
      .set(authHeader(token))
      .send({ name: 'Hijacked Store' })
      .expect(404);

    await request(ctx.app)
      .post('/api/merchant/businesses/biz-0001/products')
      .set(authHeader(token))
      .send({ name: 'Free Atta', price: 0, availability: 'AVAILABLE' })
      .expect(404);

    const victim = await request(ctx.app).get('/api/businesses/biz-0001').expect(200);
    expect(victim.body.business.name).toBe('Sharma Kirana');
  });

  it('allows the real owner to read their own business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    const token = testToken({ sub: 'owner-1' });
    const response = await request(ctx.app).get('/api/merchant/businesses/biz-0001').set(authHeader(token)).expect(200);
    expect(response.body.role).toBe('OWNER');
    expect(response.body.business.emailNotificationsEmail).toBe('shop@example.com');
  });

  it('keeps customer A from reading customer B orders', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    const customerA = seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
    const customerB = seedCustomer(ctx.prisma, { authUserId: 'cust-b', email: 'b@example.com', id: 'profile-cust-b' });
    const order = ctx.prisma.seed('order', [
      {
        orderCode: 'DS-1',
        businessId: 'biz-0001',
        customerId: customerA.id,
        fulfillment: 'PICKUP',
        status: 'NEW',
        customerName: 'Anita Roy',
        subtotal: '100.00',
        total: '100.00',
      },
    ])[0];
    ctx.prisma.seed('orderItem', [
      { orderId: order.id, productId: 'biz-0001-product-1', nameSnapshot: 'Atta', unitPriceSnapshot: '100.00', quantity: 1, lineTotal: '100.00' },
    ]);

    const tokenB = testToken({ sub: 'cust-b', email: 'b@example.com' });
    await request(ctx.app).get(`/api/customer/orders/${order.id}`).set(authHeader(tokenB)).expect(404);

    const tokenA = testToken({ sub: 'cust-a', email: 'a@example.com' });
    const own = await request(ctx.app).get(`/api/customer/orders/${order.id}`).set(authHeader(tokenA)).expect(200);
    expect(own.body.order.orderCode).toBe('DS-1');
    expect(customerB.id).toBe('profile-cust-b');
  });

  it('keeps the guest token as the only key to a guest conversation', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    const created = await request(ctx.app).post('/api/conversations').send({ businessId: 'biz-0001', locale: 'en' }).expect(201);
    const { id, guestToken } = { id: created.body.conversation.id, guestToken: created.body.guestToken };
    expect(guestToken).toBeTruthy();
    expect(guestToken.length).toBeGreaterThan(20);

    await request(ctx.app).get(`/api/conversations/${id}`).expect(403);
    await request(ctx.app).get(`/api/conversations/${id}`).set('x-guest-token', 'wrong-token').expect(403);
    await request(ctx.app).get(`/api/conversations/${id}`).set('x-guest-token', guestToken).expect(200);
  });

  it('does not let a signed-in customer read a stranger guest conversation', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
    const created = await request(ctx.app).post('/api/conversations').send({ businessId: 'biz-0001' }).expect(201);
    const token = testToken({ sub: 'cust-a', email: 'a@example.com' });
    await request(ctx.app)
      .get(`/api/conversations/${created.body.conversation.id}`)
      .set(authHeader(token))
      .expect(403);
  });

  it('keeps merchant conversations scoped to the business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    await request(ctx.app).post('/api/conversations').send({ businessId: 'biz-0001' }).expect(201);
    await request(ctx.app).post('/api/conversations').send({ businessId: 'biz-0002' }).expect(201);

    const token = testToken({ sub: 'owner-1' });
    // Merchant conversation routes are mounted under /api/conversations/business/:id
    const response = await request(ctx.app)
      .get('/api/conversations/business/biz-0001')
      .set(authHeader(token))
      .expect(200);
    expect(response.body.conversations).toHaveLength(1);
    expect(response.body.conversations[0].businessId).toBe('biz-0001');

    await request(ctx.app).get('/api/conversations/business/biz-0002').set(authHeader(token)).expect(404);
  });

  it('rejects a token whose subject is empty', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    await request(ctx.app).get('/api/merchant/businesses/biz-0001').set(authHeader('test::email:a@b.c')).expect(401);
  });
});
