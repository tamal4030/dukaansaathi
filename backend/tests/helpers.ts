import type { Express } from 'express';
import { createApp } from '../src/app';
import { FakePrisma, createFakePrisma } from './fakePrisma';
import type { AuthClaims } from '../src/middleware/auth';
import type { ChatClient, ChatMessage, ChatCompletionResult } from '../src/services/deepseek';
import type { SpeechClient } from '../src/services/sarvam';
import type { EmailMessage, EmailResult, EmailSender } from '../src/services/email';

export const FRONTEND_URL = 'http://localhost:5173';

/**
 * Test tokens look like `test:<sub>:<provider>:<email>`. The real verifier
 * checks Supabase signatures; here we only need identity for authorization
 * tests.
 */
export function testToken(claims: Partial<AuthClaims> & { sub: string }): string {
  return ['test', claims.sub, claims.provider ?? 'email', claims.email ?? '', claims.name ?? ''].join(':');
}

function parseToken(token: string): AuthClaims {
  const [, sub, provider, email, name] = token.split(':');
  return {
    sub,
    provider: provider || undefined,
    email: email || undefined,
    name: name || undefined,
  };
}

export interface TestApp {
  app: Express;
  prisma: FakePrisma;
  sentEmails: EmailMessage[];
  chatCalls: ChatMessage[][];
  setChatReply(content: string): void;
  setChatError(error: unknown): void;
  setEmailResult(result: EmailResult): void;
  setTranscript(transcript: string): void;
  transcriptionRequests: Array<{ languageCode: string; bytes: number }>;
}

export interface BuildOptions {
  emailConfigured?: boolean;
}

export function buildTestApp(options: BuildOptions = {}): TestApp {
  const prisma = createFakePrisma();
  const sentEmails: EmailMessage[] = [];
  const chatCalls: ChatMessage[][] = [];
  const transcriptionRequests: Array<{ languageCode: string; bytes: number }> = [];

  let chatReply = '{"reply": "ok", "language": "en", "proposed_items": []}';
  let chatError: unknown = null;
  let emailResult: EmailResult = { status: 'SENT' };
  let transcript = 'Do you have atta?';

  const chat: ChatClient = {
    async complete(messages: ChatMessage[]): Promise<ChatCompletionResult> {
      chatCalls.push(messages);
      if (chatError) throw chatError;
      return { content: chatReply };
    },
  };

  const speech: SpeechClient = {
    async transcribe(audio, request) {
      transcriptionRequests.push({ languageCode: request.languageCode, bytes: audio.length });
      return { transcript, languageCode: request.languageCode };
    },
    async synthesize() {
      return { audioBase64: 'AAAA', mimeType: 'audio/wav' };
    },
  };

  const email: EmailSender = {
    async send(message: EmailMessage): Promise<EmailResult> {
      sentEmails.push(message);
      return emailResult;
    },
  };

  const app = createApp(
    {
      prisma,
      chat,
      speech,
      email,
      verifier: { verify: async (token: string) => parseToken(token) },
      frontendUrl: FRONTEND_URL,
    },
    { allowAllOrigins: true },
  );

  return {
    app,
    prisma,
    sentEmails,
    chatCalls,
    transcriptionRequests,
    setChatReply: (content) => {
      chatReply = content;
      chatError = null;
    },
    setChatError: (error) => {
      chatError = error;
    },
    setEmailResult: (result) => {
      emailResult = result;
    },
    setTranscript: (value) => {
      transcript = value;
    },
  };
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Seeds one business with products, hours, FAQs and an owner. */
export function seedBusiness(
  prisma: FakePrisma,
  overrides: Partial<{
    id: string;
    name: string;
    slug: string;
    ownerAuthId: string;
    category: string;
    products: Array<{ name: string; price: string; availability: string; aliases?: string[] }>;
  }> = {},
) {
  // Real business ids are UUIDs (36 chars); route validation requires >= 6.
  const id = overrides.id ?? 'biz-0001';
  const ownerAuthId = overrides.ownerAuthId ?? 'owner-1';
  const owner = prisma.seed('userProfile', [
    {
      id: `profile-${ownerAuthId}`,
      authUserId: ownerAuthId,
      email: `${ownerAuthId}@example.com`,
      fullName: 'Owner One',
      role: 'BUSINESS_OWNER',
      emailNotificationsOptIn: true,
    },
  ])[0];

  const business = prisma.seed('business', [
    {
      id,
      ownerId: owner.id,
      name: overrides.name ?? 'Sharma Kirana',
      slug: overrides.slug ?? `slug-${id}`,
      category: overrides.category ?? 'GROCERY_DAILY_ESSENTIALS',
      addressLine: '14 Bidhan Sarani',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700006',
      publicPhone: '+91 98300 11223',
      deliveryEnabled: true,
      pickupEnabled: true,
      emailNotificationsOptIn: true,
      emailNotificationsEmail: 'shop@example.com',
      isActive: true,
      isPublic: true,
      searchText: 'sharma kirana kolkata grocery',
    },
  ])[0];

  prisma.seed('businessMember', [{ businessId: id, userId: owner.id, role: 'OWNER' }]);
  prisma.seed('businessHour', [
    { businessId: id, dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '21:00' },
  ]);
  prisma.seed('businessFaq', [
    { businessId: id, question: 'Do you deliver?', answer: 'Yes, free delivery above Rs 300.', sortOrder: 0 },
  ]);

  const products = (overrides.products ?? [
    { name: 'Aashirvaad Atta 5kg', price: '265.00', availability: 'AVAILABLE', aliases: ['atta', 'aata'] },
    { name: 'Amul Taaza Milk 500ml', price: '28.00', availability: 'OUT_OF_STOCK', aliases: ['milk'] },
    { name: 'Gobindobhog Rice 1kg', price: '95.00', availability: 'UNKNOWN', aliases: ['rice'] },
  ]).map((product, index) =>
    prisma.seed('product', [
      {
        id: `${id}-product-${index + 1}`,
        businessId: id,
        name: product.name,
        price: product.price,
        availability: product.availability,
        aliases: product.aliases ?? [],
        isArchived: false,
      },
    ])[0],
  );

  return { business, owner, products };
}

export function seedCustomer(prisma: FakePrisma, overrides: Partial<{ id: string; authUserId: string; email: string; optIn: boolean }> = {}) {
  const authUserId = overrides.authUserId ?? 'customer-1';
  return prisma.seed('userProfile', [
    {
      id: overrides.id ?? `profile-${authUserId}`,
      authUserId,
      email: overrides.email ?? 'customer@example.com',
      fullName: 'Anita Roy',
      phone: '+91 98300 00011',
      role: 'CUSTOMER',
      emailNotificationsOptIn: overrides.optIn ?? false,
    },
  ])[0];
}
