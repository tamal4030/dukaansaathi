import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, buildTestApp, seedBusiness, seedCustomer, testToken, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(() => {
  ctx = buildTestApp();
});

const GOOGLE = (sub = 'cust-a', email = 'a@example.com') => testToken({ sub, email, provider: 'google' });

function quoteBody(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz-0001',
    items: [{ productId: 'biz-0001-product-1', quantity: 2 }],
    ...overrides,
  };
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    ...quoteBody(),
    fulfillment: 'PICKUP',
    customerPhone: '+91 98300 00011',
    confirm: true,
    ...overrides,
  };
}

describe('order quoting and totals (acceptance 9)', () => {
  beforeEach(() => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
  });

  it('calculates totals from database prices, ignoring any client price', async () => {
    const response = await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0001-product-1', quantity: 2, unitPrice: '0.01', price: '0.01' }] }))
      .expect(200);

    // 265.00 x 2 = 530.00 from the database, not 0.02 from the browser.
    expect(response.body.quote.lines[0].unitPrice).toBe('265.00');
    expect(response.body.quote.lines[0].lineTotal).toBe('530.00');
    expect(response.body.quote.total).toBe('530.00');
    expect(response.body.quote.canSubmit).toBe(true);
  });

  it('reports unknown availability as not confirmable and never as available', async () => {
    const response = await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0001-product-3', quantity: 1 }] }))
      .expect(200);

    const line = response.body.quote.lines[0];
    expect(line.availability).toBe('UNKNOWN');
    expect(line.availabilityLabel).toBe('Availability unknown');
    expect(line.orderable).toBe(false);
    expect(response.body.quote.canSubmit).toBe(false);
    expect(response.body.quote.issues.join(' ')).toContain('unknown availability');
  });

  it('excludes out-of-stock and unknown lines from the payable total', async () => {
    const response = await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(
        quoteBody({
          items: [
            { productId: 'biz-0001-product-1', quantity: 1 },
            { productId: 'biz-0001-product-2', quantity: 5 },
            { productId: 'biz-0001-product-3', quantity: 5 },
          ],
        }),
      )
      .expect(200);

    expect(response.body.quote.lines).toHaveLength(3);
    expect(response.body.quote.total).toBe('265.00');
    expect(response.body.quote.canSubmit).toBe(false);
  });

  it('rejects a product that belongs to another business', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    const response = await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0002-product-1', quantity: 1 }] }))
      .expect(200);
    expect(response.body.quote.lines).toHaveLength(0);
    expect(response.body.quote.canSubmit).toBe(false);
  });

  it('validates quantity and cart shape on the server', async () => {
    await request(ctx.app).post('/api/customer/orders/quote').send(quoteBody({ items: [] })).expect(400);
    await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0001-product-1', quantity: 0 }] }))
      .expect(400);
    await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0001-product-1', quantity: 1.5 }] }))
      .expect(400);
    await request(ctx.app)
      .post('/api/customer/orders/quote')
      .send(quoteBody({ items: [{ productId: 'biz-0001-product-1', quantity: 100000 }] }))
      .expect(400);
  });
});

describe('order creation (acceptance 2, 9, 10)', () => {
  beforeEach(() => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
  });

  it('requires Google sign-in and keeps the cart for the sign-in step', async () => {
    const anonymous = await request(ctx.app).post('/api/customer/orders').send(orderBody()).expect(401);
    expect(anonymous.body.error.code).toBe('UNAUTHORIZED');

    const emailOnly = await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(testToken({ sub: 'cust-a', email: 'a@example.com', provider: 'email' })))
      .send(orderBody())
      .expect(403);
    expect(emailOnly.body.error.code).toBe('GOOGLE_SIGN_IN_REQUIRED');
    expect(emailOnly.body.error.message).toContain('cart');

    // No order was written by either attempt.
    expect(ctx.prisma.tables.order).toHaveLength(0);
  });

  it('refuses to create an order without explicit confirmation', async () => {
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ confirm: false }))
      .expect(400);
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send({ ...orderBody(), confirm: undefined })
      .expect(400);
    expect(ctx.prisma.tables.order).toHaveLength(0);
  });

  it('creates the order with item price snapshots and an initial status event', async () => {
    const response = await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody())
      .expect(201);

    const order = response.body.order;
    expect(order.status).toBe('NEW');
    expect(order.statusLabel).toBe('New');
    expect(order.total).toBe('530.00');
    expect(order.items[0].unitPrice).toBe('265.00');
    expect(order.items[0].name).toBe('Aashirvaad Atta 5kg');
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0].status).toBe('NEW');

    const stored = ctx.prisma.tables.order[0];
    expect(stored.customerId).toBe('profile-cust-a');
    // Decimal arithmetic: 265.00 x 2 stored as a numeric value, formatted on read.
    expect(Number(stored.total)).toBe(530);
    expect(ctx.prisma.tables.orderItem).toHaveLength(1);
    expect(ctx.prisma.tables.orderStatusEvent).toHaveLength(1);
  });

  it('requires a contact phone and a delivery address only for delivery', async () => {
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ customerPhone: 'abc' }))
      .expect(400);

    // pickup: no address needed
    await request(ctx.app).post('/api/customer/orders').set(authHeader(GOOGLE())).send(orderBody()).expect(201);

    // delivery: address needed
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ fulfillment: 'DELIVERY' }))
      .expect(400);

    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ fulfillment: 'DELIVERY', deliveryAddress: '27A Lake Gardens, Kolkata 700045' }))
      .expect(201);
  });

  it('refuses to order an out-of-stock or unknown item', async () => {
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ items: [{ productId: 'biz-0001-product-2', quantity: 1 }] }))
      .expect(409);

    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ items: [{ productId: 'biz-0001-product-3', quantity: 1 }] }))
      .expect(409);

    expect(ctx.prisma.tables.order).toHaveLength(0);
  });

  it('does not let a customer order from a business that is not public', async () => {
    ctx.prisma.seed('business', [
      { id: 'biz-private', ownerId: 'x', name: 'Private', slug: 'private', category: 'FOOD_BEVERAGES', isActive: false, isPublic: false },
    ]);
    await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody({ businessId: 'biz-private' }))
      .expect(404);
  });
});

describe('order status visibility and merchant updates (acceptance 10)', () => {
  let orderId: string;

  beforeEach(async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
    const created = await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE()))
      .send(orderBody())
      .expect(201);
    orderId = created.body.order.id;
  });

  it('shows the customer their own saved order and status', async () => {
    const list = await request(ctx.app).get('/api/customer/orders').set(authHeader(GOOGLE())).expect(200);
    expect(list.body.orders).toHaveLength(1);
    expect(list.body.orders[0].orderCode).toBeDefined();

    const detail = await request(ctx.app).get(`/api/customer/orders/${orderId}`).set(authHeader(GOOGLE())).expect(200);
    expect(detail.body.order.status).toBe('NEW');
    expect(detail.body.business.name).toBe('Sharma Kirana');
  });

  it('lets the owner move the order forward and records history', async () => {
    const token = testToken({ sub: 'owner-1' });
    const accepted = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'ACCEPTED', note: 'Stock confirmed' })
      .expect(200);
    expect(accepted.body.order.status).toBe('ACCEPTED');
    expect(accepted.body.previousStatus).toBe('NEW');

    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'PREPARING' })
      .expect(200);
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'READY_FOR_PICKUP' })
      .expect(200);
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' })
      .expect(200);

    const detail = await request(ctx.app).get(`/api/customer/orders/${orderId}`).set(authHeader(GOOGLE())).expect(200);
    expect(detail.body.order.status).toBe('COMPLETED');
    expect(detail.body.order.statusHistory.map((event: { status: string }) => event.status)).toEqual([
      'NEW',
      'ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'COMPLETED',
    ]);
    expect(detail.body.order.canReview).toBe(true);
  });

  it('rejects invalid transitions such as NEW to COMPLETED', async () => {
    const token = testToken({ sub: 'owner-1' });
    const response = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' })
      .expect(409);
    expect(response.body.error.message).toContain('Cannot move');
  });

  it('rejects a pickup order being marked out for delivery', async () => {
    const token = testToken({ sub: 'owner-1' });
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'ACCEPTED' })
      .expect(200);
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'PREPARING' })
      .expect(200);
    const response = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(token))
      .send({ status: 'OUT_FOR_DELIVERY' })
      .expect(409);
    expect(response.body.error.message).toContain('pickup order');
  });

  it('rejects an unknown status value', async () => {
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${orderId}/status`)
      .set(authHeader(testToken({ sub: 'owner-1' })))
      .send({ status: 'SHIPPED' })
      .expect(400);
  });

  it('rejects another business owner updating the status', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2' });
    await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0002/orders/${orderId}/status`)
      .set(authHeader(testToken({ sub: 'owner-2' })))
      .send({ status: 'ACCEPTED' })
      .expect(404);
  });
});
