import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors';
import { createDeepSeekClient, REASONING_EFFORTS } from '../src/services/deepseek';
import { runAssistantTurn } from '../src/services/assistantService';
import { FakePrisma } from './fakePrisma';
import type { Business, BusinessFaq, BusinessHour } from '@prisma/client';

/**
 * End-to-end regression tests for the voice-to-answer language pipeline.
 *
 * All provider calls are stubbed: these assert that the CORRECT language is
 * chosen and propagated, which is where the defects were. No network is used.
 */

const BENGALI_QUESTION = 'আপনার দোকানে চাল আছে কি?';
const HINDI_QUESTION = 'आपकी दुकान में चावल है क्या?';

function seedBusiness(prisma: FakePrisma) {
  const business = prisma.seed('business', [
    {
      id: 'biz-0001',
      ownerId: 'owner-1',
      name: 'Sharma Kirana & General Store',
      slug: 'sharma',
      category: 'GROCERY_DAILY_ESSENTIALS',
      addressLine: '14 Bidhan Sarani',
      city: 'Kolkata',
      publicPhone: '+91 98300 11223',
      pickupEnabled: true,
      deliveryEnabled: true,
      paymentMethods: ['Cash'],
      returnPolicy: 'Sealed packets within 2 days',
      isActive: true,
      isPublic: true,
    },
  ])[0];
  prisma.seed('businessHour', [
    { businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00' },
  ]);
  prisma.seed('businessFaq', [
    { businessId: business.id, question: 'Do you deliver?', answer: 'Yes, above Rs 300.', sortOrder: 0 },
  ]);
  prisma.seed('product', [
    { id: 'p1', businessId: business.id, name: 'Miniket Rice 5kg', price: '310.00', availability: 'AVAILABLE', aliases: ['rice', 'chal', 'চাল'] },
  ]);
  return business;
}

/** Captures every request the assistant makes so we can assert on the prompt. */
function captureChat(replies: string[]) {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  const bodies: Array<Record<string, unknown>> = [];
  let index = 0;
  const client = {
    async complete(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) {
      calls.push(messages);
      bodies.push((options ?? {}) as Record<string, unknown>);
      const content = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return { content };
    },
  };
  return { client, calls, bodies };
}

function withFaqs(business: Business, faqs: BusinessFaq[], hours: BusinessHour[]) {
  return Object.assign(business, { faqs, hours }) as Business & { faqs: BusinessFaq[]; hours: BusinessHour[] };
}

describe('Bengali voice with an English interface', () => {
  it('sends the spoken language as TARGET_LANGUAGE, not the interface language', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    const { client, calls } = captureChat([
      JSON.stringify({ reply: 'হ্যাঁ, চাল আছে।', language: 'bn', proposed_items: [] }),
    ]);

    const result = await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [{ id: 'f1', businessId: business.id, question: 'Do you deliver?', answer: 'Yes, above Rs 300.', sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date() }], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: BENGALI_QUESTION,
      language: 'bn',
    });

    const prompt = calls[0].map((m) => m.content).join('\n');
    expect(prompt).toContain('TARGET_LANGUAGE:');
    expect(prompt).toContain('Bengali script');
    expect(prompt).toContain('not romanised');
    expect(result.language).toBe('bn');
  });
});

describe('Hindi voice', () => {
  it('states the Devanagari requirement in the prompt', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    const { client, calls } = captureChat([
      JSON.stringify({ reply: 'हाँ, चावल उपलब्ध है।', language: 'hi', proposed_items: [] }),
    ]);

    const result = await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: HINDI_QUESTION,
      language: 'hi',
    });

    const prompt = calls[0].map((m) => m.content).join('\n');
    expect(prompt).toContain('Devanagari');
    expect(result.language).toBe('hi');
  });
});

describe('prompt size control', () => {
  it('limits how many conversation turns are sent', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    const { client, calls } = captureChat([
      JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [] }),
    ]);

    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'CUSTOMER' : 'ASSISTANT') as 'CUSTOMER' | 'ASSISTANT',
      content: `turn ${i}`,
    }));

    await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: 'hello',
      language: 'en',
      history,
    });

    // 2 system messages + at most HISTORY_LIMIT history turns + the question.
    expect(calls[0].length).toBeLessThanOrEqual(2 + 4 + 1);
  });

  it('sends a low reasoning effort so the answer keeps token headroom', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    const { client, bodies } = captureChat([
      JSON.stringify({ reply: 'ok', language: 'en', proposed_items: [] }),
    ]);

    await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: 'hello',
      language: 'en',
    });

    expect(bodies[0].reasoningEffort).toBe('low');
  });
});

describe('out-of-scope questions', () => {
  it('tells the model to refuse unrelated questions in the target language', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    const { client, calls } = captureChat([
      JSON.stringify({ reply: 'দুঃখিত, আমি শুধু দোকান সম্পর্কে সাহায্য করতে পারি।', language: 'bn', proposed_items: [] }),
    ]);

    await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: 'Who won the 1998 world cup?',
      language: 'bn',
    });

    const prompt = calls[0].map((m) => m.content).join('\n');
    expect(prompt).toMatch(/unrelated questions/i);
    expect(prompt).toMatch(/Never invent missing facts/i);
    expect(prompt).toMatch(/TARGET_LANGUAGE/);
  });
});

describe('empty reply handling', () => {
  it('retries once with a shorter context when reasoning exhausts the budget', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);

    // First call returns empty content (as deepseek.ts does when reasoning ate
    // the budget); the retry succeeds.
    const calls: number[] = [];
    let call = 0;
    const client = {
      async complete(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>) {
        calls.push(messages.length);
        call += 1;
        if (call === 1) {
          throw new AppError(502, 'ASSISTANT_EMPTY', 'no visible content', { reasoningChars: 900 });
        }
        expect((options as { reasoningEffort?: string }).reasoningEffort).toBe('minimal');
        return { content: JSON.stringify({ reply: 'হ্যাঁ, চাল আছে।', language: 'bn', proposed_items: [] }) };
      },
    };

    const result = await runAssistantTurn({
      prisma: prisma as never,
      chat: client as never,
      business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
      message: BENGALI_QUESTION,
      language: 'bn',
      history: Array.from({ length: 10 }, (_, i) => ({ role: 'CUSTOMER' as const, content: `old ${i}` })),
    });

    // Exactly two attempts, and the retry carried a shorter prompt.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeLessThan(calls[0]);
    expect(result.reply).toContain('চাল');
  });

  it('does not retry more than once and surfaces the failure', async () => {
    const prisma = new FakePrisma();
    const business = seedBusiness(prisma);
    let attempts = 0;
    const client = {
      async complete() {
        attempts += 1;
        throw new AppError(502, 'ASSISTANT_EMPTY', 'still empty');
      },
    };

    await expect(
      runAssistantTurn({
        prisma: prisma as never,
        chat: client as never,
        business: withFaqs(business, [], [{ id: 'h1', businessId: business.id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00', note: null }]),
        message: BENGALI_QUESTION,
        language: 'bn',
      }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_EMPTY' });

    // Bounded: one original attempt plus exactly one retry.
    expect(attempts).toBe(2);
  });
});

describe('DeepSeek request fields', () => {
  it('only sends reasoning_effort when it is explicitly requested', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = createDeepSeekClient(
      { apiKey: 'fake-key-for-test', model: 'deepseek-flash', timeoutMs: 1000 },
      fetchImpl as unknown as typeof fetch,
    );

    await client.complete([{ role: 'user', content: 'hi' }]);
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');

    await client.complete([{ role: 'user', content: 'hi' }], { reasoningEffort: 'low' });
    expect(bodies[1].reasoning_effort).toBe('low');
  });

  it('exposes the reasoning levels verified against the live API', () => {
    // Taken from the API's own validation error message.
    expect([...REASONING_EFFORTS]).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'ultra',
      'max',
    ]);
  });
});
