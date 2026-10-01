import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppError } from '../src/lib/errors';
import { authHeader, buildTestApp, seedBusiness, seedCustomer, testToken, type TestApp } from './helpers';

let ctx: TestApp;

beforeEach(() => {
  ctx = buildTestApp();
  seedBusiness(ctx.prisma, { id: 'biz-0001', name: 'Sharma Kirana' });
  seedBusiness(ctx.prisma, { id: 'biz-0002', ownerAuthId: 'owner-2', name: 'Ritu Sarees', category: 'FASHION_TEXTILES' });
});

async function startConversation(businessId = 'biz-0001') {
  const response = await request(ctx.app).post('/api/conversations').send({ businessId, locale: 'en' }).expect(201);
  return { id: response.body.conversation.id as string, guestToken: response.body.guestToken as string };
}

function systemPromptText(): string {
  const call = ctx.chatCalls[ctx.chatCalls.length - 1];
  return call.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
}

describe('public chat (acceptance 6 and 7)', () => {
  it('binds a guest conversation to one business and only sends that business data', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'We have atta.', language: 'en', proposed_items: [] }));

    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'Do you have atta?', locale: 'en' })
      .expect(201);

    const prompt = systemPromptText();
    expect(prompt).toContain('Sharma Kirana');
    expect(prompt).toContain('Aashirvaad Atta 5kg');
    expect(prompt).toContain('biz-0001-product-1');
    // Nothing from the other business may leak into the prompt.
    expect(prompt).not.toContain('Ritu Sarees');
    expect(prompt).not.toContain('biz-0002-product-1');
    expect(response.body.business.id).toBe('biz-0001');
  });

  it('rejects a client-supplied business id as a way to switch business', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'show me sarees', businessId: 'biz-0002', locale: 'en' })
      .expect(201);

    const prompt = systemPromptText();
    expect(prompt).not.toContain('Ritu Sarees');
    expect(prompt).toContain('Sharma Kirana');
  });

  it('sends only matching products rather than the whole catalogue', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'do you have milk?', locale: 'en' })
      .expect(201);

    const prompt = systemPromptText();
    expect(prompt).toContain('Amul Taaza Milk');
    expect(prompt).not.toContain('Aashirvaad Atta');
  });

  it('passes the customer language and marks unknown availability as unconfirmable', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'ঠিক আছে', language: 'bn', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'rice ache?', locale: 'bn' })
      .expect(201);

    const prompt = systemPromptText();
    expect(prompt).toContain('Bengali');
    expect(prompt).toContain('Availability unknown');
    expect(prompt).toContain('never say it is available');
  });

  it('states that store hours are unknown when none are published', async () => {
    ctx.prisma.seed('business', [
      { id: 'biz-nohours', ownerId: 'x', name: 'No Hours Store', slug: 'no-hours', category: 'FOOD_BEVERAGES', isActive: true, isPublic: true },
    ]);
    ctx.prisma.seed('product', [
      { id: 'biz-nohours-product-1', businessId: 'biz-nohours', name: 'Tea', price: '10.00', availability: 'AVAILABLE' },
    ]);
    const { id, guestToken } = await startConversation('biz-nohours');
    ctx.setChatReply(JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'what time do you open?', locale: 'en' })
      .expect(201);

    const prompt = systemPromptText();
    expect(prompt).toContain('NOT PROVIDED');
    expect(prompt).toContain('cannot confirm opening or closing times');
  });

  it('tells the model when nothing matched instead of inviting invention', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'I could not find that.', language: 'en', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'do you sell washing machines?', locale: 'en' })
      .expect(201);

    expect(systemPromptText()).toContain('No matching products were found');
  });

  it('stores both the customer and assistant messages on the conversation', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(JSON.stringify({ reply: 'Yes, 265 rupees.', language: 'en', proposed_items: [] }));

    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'atta price?', locale: 'en' })
      .expect(201);

    const stored = ctx.prisma.tables.message.filter((message) => message.conversationId === id);
    expect(stored).toHaveLength(2);
    expect(stored[0].role).toBe('CUSTOMER');
    expect(stored[1].role).toBe('ASSISTANT');
    expect(stored.every((message) => message.conversationId === id)).toBe(true);
  });

  it('validates message length and rejects empty messages', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    await request(ctx.app).post(`/api/conversations/${id}/messages`).set('x-guest-token', guestToken).send({ content: '' }).expect(400);
    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'x'.repeat(2001) })
      .expect(400);
  });
});

describe('assistant order guardrails (acceptance 8)', () => {
  it('validates proposed items against this business and returns database prices', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(
      JSON.stringify({
        reply: 'I can add 2 kg atta.',
        language: 'en',
        proposed_items: [
          { product_id: 'biz-0001-product-1', quantity: 2 },
          { product_id: 'biz-0002-product-1', quantity: 3 },
          { product_id: 'made-up-id', quantity: 1 },
        ],
      }),
    );

    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'add 2 atta', locale: 'en' })
      .expect(201);

    const proposals = response.body.assistant.proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].productId).toBe('biz-0001-product-1');
    expect(proposals[0].unitPrice).toBe('265.00');
    expect(proposals[0].lineTotal).toBe('530.00');
    expect(proposals[0].orderable).toBe(true);
  });

  it('marks an out-of-stock proposal as not orderable', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply(
      JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [{ product_id: 'biz-0001-product-2', quantity: 1 }] }),
    );
    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'add milk', locale: 'en' })
      .expect(201);
    expect(response.body.assistant.proposals[0].orderable).toBe(false);
    expect(response.body.assistant.proposals[0].availabilityLabel).toBe('Out of stock');
  });

  it('creates no order when the model claims one was placed, and rewrites the claim', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    seedCustomer(ctx.prisma, { authUserId: 'cust-a' });
    ctx.setChatReply(
      JSON.stringify({
        reply: 'Your order has been placed successfully and payment has been received.',
        language: 'en',
        proposed_items: [{ product_id: 'biz-0001-product-1', quantity: 1 }],
      }),
    );

    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'place my order', locale: 'en' })
      .expect(201);

    expect(response.body.assistant.reply).toContain('I have not placed any order');
    expect(response.body.assistant.reply).not.toContain('has been placed');
    expect(response.body.assistant.reply).toContain('cannot confirm any payment');
    // A proposal is not an order.
    expect(ctx.prisma.tables.order).toHaveLength(0);
  });

  it('keeps a plain-text answer usable and proposes nothing', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatReply('We are open from 9 am to 9 pm.');
    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'when do you open?', locale: 'en' })
      .expect(201);
    expect(response.body.assistant.reply).toBe('We are open from 9 am to 9 pm.');
    expect(response.body.assistant.proposals).toEqual([]);
    expect(ctx.prisma.tables.order).toHaveLength(0);
  });

  it('shows an honest notice when DeepSeek is unavailable and never calls another provider', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatError(new AppError(503, 'NOT_CONFIGURED', 'The assistant is not configured on the server yet.'));

    const response = await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'hello', locale: 'bn' })
      .expect(201);

    expect(response.body.assistant.available).toBe(false);
    expect(response.body.assistant.notice.code).toBe('NOT_CONFIGURED');
    expect(response.body.assistant.reply).toContain('সহকারী');
    // The transcript stays visible: both messages are persisted.
    expect(ctx.prisma.tables.message.filter((message) => message.conversationId === id)).toHaveLength(2);
  });

  it('propagates unexpected errors instead of masking them as assistant outages', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    ctx.setChatError(new Error('unexpected boom'));
    await request(ctx.app)
      .post(`/api/conversations/${id}/messages`)
      .set('x-guest-token', guestToken)
      .send({ content: 'hello', locale: 'en' })
      .expect(500);
  });
});

describe('conversation feedback', () => {
  it('accepts guest feedback tied to the anonymous conversation and rejects duplicates', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    await request(ctx.app)
      .post(`/api/conversations/${id}/feedback`)
      .set('x-guest-token', guestToken)
      .send({ rating: 5, comment: 'Helpful' })
      .expect(201);

    const stored = ctx.prisma.tables.conversationFeedback.filter((entry) => entry.conversationId === id);
    expect(stored).toHaveLength(1);
    expect(stored[0].rating).toBe(5);

    await request(ctx.app)
      .post(`/api/conversations/${id}/feedback`)
      .set('x-guest-token', guestToken)
      .send({ rating: 1 })
      .expect(400);
  });

  it('validates the feedback rating range', async () => {
    const { id, guestToken } = await startConversation('biz-0001');
    await request(ctx.app).post(`/api/conversations/${id}/feedback`).set('x-guest-token', guestToken).send({ rating: 6 }).expect(400);
    await request(ctx.app).post(`/api/conversations/${id}/feedback`).set('x-guest-token', guestToken).send({ rating: 0 }).expect(400);
  });

  it('lets the owner resolve a conversation', async () => {
    seedBusiness(ctx.prisma, { id: 'biz-0001', ownerAuthId: 'owner-1' });
    const { id } = await startConversation('biz-0001');
    const token = testToken({ sub: 'owner-1' });
    const response = await request(ctx.app)
      .patch(`/api/conversations/business/biz-0001/${id}`)
      .set(authHeader(token))
      .send({ status: 'RESOLVED' })
      .expect(200);
    expect(response.body.conversation.status).toBe('RESOLVED');
  });
});
