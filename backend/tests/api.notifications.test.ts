import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authHeader, buildTestApp, seedBusiness, seedCustomer, testToken, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(() => {
  ctx = buildTestApp();
});

const GOOGLE = testToken({ sub: 'cust-a', email: 'a@example.com', provider: 'google' });
const OWNER = testToken({ sub: 'owner-1' });

function orderBody() {
  return {
    businessId: 'biz-0001',
    items: [{ productId: 'biz-0001-product-1', quantity: 1 }],
    fulfillment: 'PICKUP',
    customerPhone: '+91 98300 00011',
    confirm: true,
  };
}

describe('opt-in transactional email (acceptance 11)', () => {
  it('emails the business on a new order only when it opted in', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });

    await request(ctx.app).post('/api/customer/orders').set(authHeader(GOOGLE)).send(orderBody()).expect(201);
    expect(ctx.sentEmails).toHaveLength(1);
    expect(ctx.sentEmails[0].to).toBe('shop@example.com');
    expect(ctx.sentEmails[0].subject).toContain('New order');

    const log = ctx.prisma.tables.notificationLog[0];
    expect(log.type).toBe('ORDER_CREATED_BUSINESS');
    expect(log.status).toBe('SENT');
  });

  it('skips the business email when the business opted out, and says so honestly', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
    ctx.prisma.tables.business[0].emailNotificationsOptIn = false;

    const response = await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE))
      .send(orderBody())
      .expect(201);

    expect(ctx.sentEmails).toHaveLength(0);
    expect(response.body.notifications.businessEmail).toBe('SKIPPED');
    expect(response.body.notifications.note).toContain('no email was sent');
    expect(ctx.prisma.tables.notificationLog[0].status).toBe('SKIPPED');
  });

  it('keeps the order saved and usable when email delivery fails', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com' });
    ctx.setEmailResult({ status: 'FAILED', error: 'provider down' });

    const response = await request(ctx.app)
      .post('/api/customer/orders')
      .set(authHeader(GOOGLE))
      .send(orderBody())
      .expect(201);

    expect(response.body.order.status).toBe('NEW');
    expect(response.body.order.total).toBe('265.00');
    expect(response.body.notifications.businessEmail).toBe('FAILED');
    expect(response.body.notifications.note).toContain('could not be delivered');
    expect(ctx.prisma.tables.order).toHaveLength(1);
    expect(ctx.prisma.tables.orderItem).toHaveLength(1);
    expect(ctx.prisma.tables.notificationLog[0].status).toBe('FAILED');
    expect(ctx.prisma.tables.notificationLog[0].error).toBe('provider down');
  });

  it('emails the customer about a status change only when the customer opted in', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com', optIn: true });

    const created = await request(ctx.app).post('/api/customer/orders').set(authHeader(GOOGLE)).send(orderBody()).expect(201);
    ctx.sentEmails.length = 0;

    const response = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${created.body.order.id}/status`)
      .set(authHeader(OWNER))
      .send({ status: 'ACCEPTED' })
      .expect(200);

    expect(response.body.notifications.customerEmail).toBe('SENT');
    expect(ctx.sentEmails).toHaveLength(1);
    expect(ctx.sentEmails[0].to).toBe('a@example.com');
    expect(ctx.sentEmails[0].subject).toContain('Accepted');
  });

  it('does not email the customer who did not opt in', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001' });
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com', optIn: false });

    const created = await request(ctx.app).post('/api/customer/orders').set(authHeader(GOOGLE)).send(orderBody()).expect(201);
    ctx.sentEmails.length = 0;

    const response = await request(ctx.app)
      .patch(`/api/merchant/businesses/biz-0001/orders/${created.body.order.id}/status`)
      .set(authHeader(OWNER))
      .send({ status: 'ACCEPTED' })
      .expect(200);

    expect(response.body.notifications.customerEmail).toBe('SKIPPED');
    expect(response.body.notifications.note).toContain('has not opted in');
    expect(ctx.sentEmails).toHaveLength(0);
  });

  it('lets a customer change their own notification preference', async () => {
    seedCustomer(ctx.prisma, { authUserId: 'cust-a', email: 'a@example.com', optIn: false });
    const updated = await request(ctx.app)
      .patch('/api/account/profile')
      .set(authHeader(testToken({ sub: 'cust-a', email: 'a@example.com' })))
      .send({ emailNotificationsOptIn: true, phone: '+91 98300 99999' })
      .expect(200);
    expect(updated.body.profile.emailNotificationsOptIn).toBe(true);
    expect(updated.body.profile.phone).toBe('+91 98300 99999');
  });
});
