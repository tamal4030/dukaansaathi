import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Conversation, Message } from '@prisma/client';
import { asyncHandler } from '../middleware/error';
import { aiLimiter, publicLimiter } from '../middleware/rateLimit';
import { badRequest, forbidden, notConfigured, notFound } from '../lib/errors';
import { parseBody } from '../lib/validate';
import { computeOpenState } from '../lib/hours';
import { logger } from '../lib/logger';
import { allowedTransitions, statusLabel } from '../lib/orderStatus';
import { isLanguageCode, type LanguageCode } from '../services/prompt';
import { runAssistantTurn, type AssistantCartLine } from '../services/assistantService';
import { conversationToMerchant, messageToPublic } from '../services/serializers';
import { REVIEW_TAG_IDS } from '../lib/reviews';
import type { AppDeps } from '../app';
import type { createAuthMiddleware } from '../middleware/auth';

type Auth = ReturnType<typeof createAuthMiddleware>;

const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_FOR_MODEL = 8;

const createSchema = z.object({
  businessId: z.string().trim().min(6).max(60),
  locale: z.enum(['en', 'bn', 'hi']).optional(),
});

const messageSchema = z.object({
  content: z.string().trim().min(1, 'Type a question first.').max(MAX_MESSAGE_LENGTH),
  locale: z.enum(['en', 'bn', 'hi']).optional(),
  source: z.enum(['TEXT', 'VOICE']).optional(),
  cart: z
    .array(
      z.object({
        productId: z.string().trim().max(60).nullish(),
        name: z.string().trim().max(200),
        quantity: z.coerce.number().int().min(1).max(999),
        unitPrice: z.string().trim().max(20),
        availability: z.string().trim().max(40).nullish(),
      }),
    )
    .max(50)
    .optional(),
});

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

const statusSchema = z.object({ status: z.enum(['OPEN', 'RESOLVED']) });

export function guestTokenFrom(req: { header: (name: string) => string | undefined; query: unknown }): string | null {
  const header = req.header('x-guest-token');
  if (header && header.trim()) return header.trim();
  const query = req.query as Record<string, unknown> | undefined;
  const fromQuery = query?.guestToken;
  return typeof fromQuery === 'string' && fromQuery.trim() ? fromQuery.trim() : null;
}

function newGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Authorization for a conversation: the signed-in owner, or the guest token
 * issued by the server when the conversation was created. A client-supplied
 * business id is never used as authorization.
 */
async function loadConversation(
  deps: AppDeps,
  req: Parameters<typeof guestTokenFrom>[0] & { auth?: { profile: { id: string } } },
  conversationId: string,
): Promise<Conversation> {
  const conversation = await deps.prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw notFound('That conversation could not be found.');

  if (req.auth?.profile && conversation.userId === req.auth.profile.id) return conversation;

  const token = guestTokenFrom(req);
  if (token && conversation.guestToken && token === conversation.guestToken) return conversation;

  throw forbidden('You do not have access to this conversation.');
}

export function conversationRouter(deps: AppDeps, auth: Auth): Router {
  const router = Router();
  const { prisma } = deps;

  /** Starts a conversation for one specific, server-validated business. */
  router.post(
    '/',
    publicLimiter,
    auth.optionalAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const business = await prisma.business.findFirst({
        where: { id: body.businessId, isActive: true, isPublic: true },
        select: { id: true, name: true, slug: true },
      });
      if (!business) throw notFound('That business is not available right now.');

      const profile = req.auth?.profile;
      const conversation = await prisma.conversation.create({
        data: {
          businessId: business.id,
          userId: profile?.id ?? null,
          guestToken: profile ? null : newGuestToken(),
          customerLocale: body.locale ?? profile?.locale ?? 'en',
        },
      });

      res.status(201).json({
        conversation: {
          id: conversation.id,
          businessId: conversation.businessId,
          status: conversation.status,
          customerLocale: conversation.customerLocale,
          createdAt: conversation.createdAt,
        },
        guestToken: conversation.guestToken,
        business,
      });
    }),
  );

  router.get(
    '/:conversationId',
    publicLimiter,
    auth.optionalAuth,
    asyncHandler(async (req, res) => {
      const conversation = await loadConversation(deps, req, req.params.conversationId);
      const business = await prisma.business.findUnique({
        where: { id: conversation.businessId },
        select: { id: true, name: true, slug: true, category: true },
      });
      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      res.json({
        conversation: {
          id: conversation.id,
          businessId: conversation.businessId,
          status: conversation.status,
          customerLocale: conversation.customerLocale,
          createdAt: conversation.createdAt,
        },
        business,
        messages: messages.map(messageToPublic),
      });
    }),
  );

  /**
   * Adds a customer message and runs the assistant for the conversation's own
   * business. The business always comes from the stored conversation.
   */
  router.post(
    '/:conversationId/messages',
    aiLimiter,
    auth.optionalAuth,
    asyncHandler(async (req, res) => {
      const conversation = await loadConversation(deps, req, req.params.conversationId);
      const body = parseBody(messageSchema, req.body);
      const language: LanguageCode = body.locale ?? (isLanguageCode(conversation.customerLocale) ? conversation.customerLocale : 'en');

      const business = await prisma.business.findFirst({
        where: { id: conversation.businessId, isActive: true, isPublic: true },
        include: { hours: true, faqs: true },
      });
      if (!business) throw notFound('That business is not available right now.');

      const customerMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'CUSTOMER',
          content: body.content,
          language,
          source: body.source ?? 'TEXT',
        },
      });

      const history = await prisma.message.findMany({
        where: { conversationId: conversation.id, id: { not: customerMessage.id } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_FOR_MODEL,
        select: { role: true, content: true },
      });

      const lastOrderRow = req.auth?.profile
        ? await prisma.order.findFirst({
            where: { customerId: req.auth.profile.id, businessId: business.id },
            orderBy: { createdAt: 'desc' },
            select: { orderCode: true, status: true },
          })
        : null;
      const lastOrder = lastOrderRow
        ? { code: lastOrderRow.orderCode, status: statusLabel(lastOrderRow.status) }
        : null;

      const cart: AssistantCartLine[] = body.cart ?? [];
      let assistantText: string;
      let proposals: Awaited<ReturnType<typeof runAssistantTurn>>['proposals'] = [];
      let notice: { code: string; message: string } | null = null;

      try {
        const result = await runAssistantTurn({
          prisma,
          chat: deps.chat,
          business,
          message: body.content,
          language,
          history: history.reverse().map((item) => ({ role: item.role as 'CUSTOMER' | 'ASSISTANT', content: item.content })),
          cart,
          lastOrder,
        });
        assistantText = result.reply;
        proposals = result.proposals;
      } catch (error) {
        // DeepSeek is the only provider: we surface an honest notice instead of
        // answering from another model or inventing data.
        const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 500;
        if (![503, 429, 502, 504].includes(status)) { console.log('ASSISTANT_THROWN', (error as Error).stack); throw error; }
        const appError = error as { code?: string; message: string };
        assistantText = FALLBACK[language];
        // The customer sees a localized sentence explaining what happened,
        // rather than a raw provider error.
        notice = {
          code: appError.code ?? 'ASSISTANT_UNAVAILABLE',
          message: FALLBACK_NOTICE[language],
        };
        logger.warn('assistant unavailable, stored fallback notice', { code: notice.code });
      }

      const assistantMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: assistantText,
          language,
          source: 'TEXT',
        },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date(), customerLocale: language, status: 'OPEN' },
      });

      res.status(201).json({
        messages: [messageToPublic(customerMessage), messageToPublic(assistantMessage)],
        assistant: {
          reply: assistantMessage.content,
          language,
          proposals,
          available: notice === null,
          notice,
        },
        business: { id: business.id, name: business.name, slug: business.slug, openState: computeOpenState(business.hours) },
      });
    }),
  );

  /** Optional feedback, allowed for guests because it is tied to the conversation. */
  router.post(
    '/:conversationId/feedback',
    publicLimiter,
    auth.optionalAuth,
    asyncHandler(async (req, res) => {
      const conversation = await loadConversation(deps, req, req.params.conversationId);
      const body = parseBody(feedbackSchema, req.body);
      const existing = await prisma.conversationFeedback.findUnique({ where: { conversationId: conversation.id } });
      if (existing) throw badRequest('Feedback for this conversation was already recorded. Thank you!');

      const feedback = await prisma.conversationFeedback.create({
        data: { conversationId: conversation.id, rating: body.rating, comment: body.comment ?? null },
      });
      res.status(201).json({ feedback: { id: feedback.id, rating: feedback.rating, comment: feedback.comment } });
    }),
  );

  /** Merchant view of conversations for one owned business. */
  router.get(
    '/business/:businessId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const { requireBusinessAccess } = await import('../services/businessAccess');
      await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const query = req.query as Record<string, string | undefined>;
      const status = query.status === 'OPEN' || query.status === 'RESOLVED' ? query.status : undefined;

      const conversations = await prisma.conversation.findMany({
        where: { businessId: req.params.businessId, ...(status ? { status } : {}) },
        include: {
          user: { select: { fullName: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
      });
      res.json({ conversations: conversations.map(conversationToMerchant) });
    }),
  );

  router.get(
    '/business/:businessId/:conversationId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const { requireBusinessAccess } = await import('../services/businessAccess');
      await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.conversationId, businessId: req.params.businessId },
        include: {
          user: { select: { fullName: true, email: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!conversation) throw notFound('That conversation could not be found for this business.');
      const feedback = await prisma.conversationFeedback.findUnique({ where: { conversationId: conversation.id } });
      res.json({
        conversation: {
          ...conversationToMerchant(conversation as Conversation & { messages: Message[] }),
          feedback: feedback ? { rating: feedback.rating, comment: feedback.comment, createdAt: feedback.createdAt } : null,
        },
      });
    }),
  );

  router.patch(
    '/business/:businessId/:conversationId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const { requireBusinessAccess } = await import('../services/businessAccess');
      await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const body = parseBody(statusSchema, req.body);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.conversationId, businessId: req.params.businessId },
      });
      if (!conversation) throw notFound('That conversation could not be found for this business.');
      const updated = await prisma.conversation.update({ where: { id: conversation.id }, data: { status: body.status } });
      res.json({ conversation: { id: updated.id, status: updated.status } });
    }),
  );

  return router;
}

/**
 * Localized fallbacks, used only when no answer could be produced at all.
 * Each one says plainly that the answer is unavailable and offers the shop as
 * the next step - it never pretends an answer exists.
 */
const FALLBACK: Record<LanguageCode, string> = {
  en:
    'Sorry, I cannot answer that right now because the assistant service is unavailable. Please try again in a moment, or contact the business directly.',
  bn:
    'দুঃখিত, সহকারী সেবা এখন কাজ করছে না, তাই এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন, অথবা সরাসরি দোকানের সাথে যোগাযোগ করুন।',
  hi:
    'क्षमा करें, सहायक सेवा अभी उपलब्ध नहीं है, इसलिए मैं इस समय जवाब नहीं दे सकता। थोड़ी देर बाद प्रयास करें, या सीधे दुकान से संपर्क करें।',
};

/** Notice text shown next to the fallback, localized for the same reason. */
const FALLBACK_NOTICE: Record<LanguageCode, string> = {
  en: 'The assistant could not answer just now. Your question is still here - you can try again or contact the shop.',
  bn: 'সহকারী এই মুহূর্তে উত্তর দিতে পারেনি। আপনার প্রশ্ন এখানেই আছে - আবার চেষ্টা করতে পারেন বা দোকানে যোগাযোগ করতে পারেন।',
  hi: 'सहायक अभी जवाब नहीं दे सका। आपका सवाल यहीं है - दोबारा कोशिश करें या दुकान से संपर्क करें।',
};

export const conversationSchemas = { createSchema, messageSchema, feedbackSchema, statusSchema, REVIEW_TAG_IDS, notConfigured };
