import { Prisma, type Business, type BusinessFaq, type BusinessHour, type Product } from '@prisma/client';
import type { Db } from '../db/prisma';
import { availabilityLabel, isOrderable } from '../lib/availability';
import { categoryLabel } from '../lib/categories';
import { computeOpenState, toPublicHours, type OpenState } from '../lib/hours';
import { money } from '../lib/money';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { findRelevantProducts, tokenize } from './search';
import { parseAssistantPayload } from './assistantResponse';
import { guardAssistantReply } from './assistantGuard';
import { OUTPUT_CONTRACT, renderSystemPrompt, languageName, replyMatchesScript, type LanguageCode } from './prompt';
import type { ChatClient, ChatMessage } from './deepseek';

export interface AssistantCartLine {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  availability?: string | null;
}

export interface AssistantTurnInput {
  prisma: Db;
  chat: ChatClient;
  business: Business & { hours: BusinessHour[]; faqs: BusinessFaq[] };
  message: string;
  language: LanguageCode;
  history?: Array<{ role: 'CUSTOMER' | 'ASSISTANT'; content: string }>;
  cart?: AssistantCartLine[];
  lastOrder?: { code: string; status: string } | null;
}

export interface ValidatedProposal {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  availability: string;
  availabilityLabel: string;
  orderable: boolean;
  lineTotal: string;
}

export interface AssistantTurnResult {
  reply: string;
  language: LanguageCode;
  proposals: ValidatedProposal[];
  matchedProductCount: number;
  structured: boolean;
  guardRewritten: boolean;
}

export function buildBusinessProfileBlock(
  business: Business & { hours: BusinessHour[] },
  openState: OpenState,
): string {
  const address = [business.addressLine, business.city, business.state, business.pincode]
    .filter(Boolean)
    .join(', ');
  const lines = [
    `Business ID: ${business.id}`,
    `Name: ${business.name}`,
    `Category: ${categoryLabel(business.category)}`,
    `Address: ${address || 'Not provided'}`,
    `Public phone: ${business.publicPhone || 'Not provided'}`,
    `Public email: ${business.publicEmail || 'Not provided'}`,
    `Open now (calculated from store hours): ${
      openState === 'unknown' ? 'Unknown - the business has not published its hours' : openState === 'open' ? 'Open' : 'Closed'
    }`,
    `Pickup: ${business.pickupEnabled ? 'Available' : 'Not offered'}`,
    `Delivery: ${business.deliveryEnabled ? 'Available' : 'Not offered'}${
      business.deliveryNotes ? ` (${business.deliveryNotes})` : ''
    }`,
    `Accepted payment methods (information only, payments are not processed in this app): ${
      business.paymentMethods.length ? business.paymentMethods.join(', ') : 'Not provided'
    }`,
    `Return policy: ${business.returnPolicy || 'Not provided'}`,
  ];
  if (business.assistantNotes) lines.push(`Extra store information from the owner: ${business.assistantNotes}`);
  return lines.join('\n');
}

export function selectRelevantFaqs(faqs: BusinessFaq[], message: string, limit = 6): BusinessFaq[] {
  const active = faqs.filter((faq) => faq.isActive);
  if (active.length === 0) return [];
  const tokens = tokenize(message);
  if (tokens.length === 0) return active.slice(0, limit);
  const scored = active
    .map((faq) => {
      const haystack = `${faq.question} ${faq.answer}`.toLowerCase();
      const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
      return { faq, score };
    })
    .sort((a, b) => b.score - a.score || a.faq.sortOrder - b.faq.sortOrder);
  const relevant = scored.filter((entry) => entry.score > 0).map((entry) => entry.faq);
  return (relevant.length > 0 ? relevant : scored.map((entry) => entry.faq)).slice(0, limit);
}

export function buildFactsBlock(
  business: Business & { hours: BusinessHour[]; faqs: BusinessFaq[] },
  message: string,
): string {
  const hours = toPublicHours(business.hours);
  const hoursText =
    hours.length === 0
      ? 'Store hours: NOT PROVIDED. You cannot confirm opening or closing times.'
      : hours
          .map((hour) =>
            hour.isClosed
              ? `${hour.day}: Closed`
              : `${hour.day}: ${hour.openTime ?? '?'} - ${hour.closeTime ?? '?'}${hour.note ? ` (${hour.note})` : ''}`,
          )
          .join('\n');

  const faqs = selectRelevantFaqs(business.faqs, message);
  const faqText =
    faqs.length === 0
      ? 'FAQs: none published by this business.'
      : faqs.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n');

  return [`Store hours (Asia/Kolkata):\n${hoursText}`, '', faqText].join('\n');
}

export function buildProductsBlock(products: Array<{ product: Product; score: number }>): string {
  if (products.length === 0) {
    return 'No matching products were found in this business\'s catalog for this request. Say that you could not find it and offer to ask the business.';
  }
  return products
    .map(({ product }) =>
      [
        `- product_id: ${product.id}`,
        `  name: ${product.name}`,
        `  price: Rs ${money(product.price)}`,
        `  availability: ${availabilityLabel(product.availability)}${
          product.availability === 'UNKNOWN' ? ' (you cannot confirm availability - never say it is available)' : ''
        }`,
        product.category ? `  category: ${product.category}` : null,
        product.aliases.length ? `  also known as: ${product.aliases.join(', ')}` : null,
        product.description ? `  description: ${product.description}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
}

export function buildOrderContextBlock(
  cart: AssistantCartLine[] | undefined,
  lastOrder: { code: string; status: string } | null | undefined,
): string {
  const lines: string[] = [];
  if (cart && cart.length > 0) {
    lines.push('Draft cart the customer is building in the app (prices come from the business database):');
    cart.forEach((line) => {
      lines.push(
        `- ${line.name} x${line.quantity} at Rs ${line.unitPrice} each${
          line.availability ? ` (availability: ${line.availability})` : ''
        }`,
      );
    });
    lines.push('No order has been placed yet. The customer must confirm in the app.');
  } else {
    lines.push('The customer has no items in a draft cart yet.');
  }
  if (lastOrder) {
    lines.push(`Most recent order from this customer at this business: ${lastOrder.code} (status: ${lastOrder.status}).`);
  }
  lines.push('You cannot place, confirm, change or cancel orders, and you cannot see payment information.');
  return lines.join('\n');
}

/** Conversation turns sent to the model. Kept small on purpose: older turns
 * add prompt tokens without changing the answer, and prompt size is what makes
 * a reasoning model burn its output budget. */
const HISTORY_LIMIT = 4;

/** Products included in the prompt. Retrieval already ranks them, so the tail
 * adds noise and tokens rather than accuracy. */
const MATCHED_PRODUCT_LIMIT = 8;

/** Verified live: deepseek-flash accepts reasoning_effort and `low` cut
 * reasoning tokens by more than half on a sample prompt. */
const REASONING_EFFORT_DEFAULT = 'low' as const;

export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const { prisma, chat, business, message, language } = input;
  const openState = computeOpenState(business.hours);
  const matched = await findRelevantProducts(prisma, business.id, message, MATCHED_PRODUCT_LIMIT);

  const systemPrompt = renderSystemPrompt({
    // The language the customer SPOKE or explicitly chose. It is never taken
    // from the interface language, so someone browsing in English who speaks
    // Bengali still gets a Bengali reply.
    targetLanguage: `${languageName(language)} (reply in this language)`,
    businessContext: buildBusinessProfileBlock(business, openState),
    matchedProducts: buildProductsBlock(matched),
    relevantStoreFacts: buildFactsBlock(business, message),
    orderContext: buildOrderContextBlock(input.cart, input.lastOrder),
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: OUTPUT_CONTRACT },
  ];
  for (const turn of (input.history ?? []).slice(-HISTORY_LIMIT)) {
    messages.push({ role: turn.role === 'CUSTOMER' ? 'user' : 'assistant', content: turn.content.slice(0, 2000) });
  }
  messages.push({ role: 'user', content: message.slice(0, 2000) });

  /**
   * Reasoning tokens share max_tokens with the JSON answer. If the model spends
   * the whole budget reasoning, `content` is empty and there is nothing to show
   * the customer. In that case retry ONCE with the same model, a lower
   * reasoning effort and a shorter context - never a different provider, and
   * never more than one retry.
   */
  let parsed: ReturnType<typeof parseAssistantPayload>;
  try {
    const completion = await chat.complete(messages, {
      temperature: 0.2,
      maxTokens: 2500,
      jsonMode: true,
      reasoningEffort: REASONING_EFFORT_DEFAULT,
    });
    parsed = parseAssistantPayload(completion.content);
  } catch (error) {
    const isEmpty = error instanceof AppError && error.code === 'ASSISTANT_EMPTY';
    if (!isEmpty) throw error;

    logger.warn('assistant produced no visible content, retrying once with a shorter context');

    // Drop the history and keep only the current question, and ask for less
    // reasoning so the visible answer has room.
    const trimmed: ChatMessage[] = [
      messages[0],
      messages[1],
      { role: 'user', content: message.slice(0, 600) },
    ];
    const retry = await chat.complete(trimmed, {
      temperature: 0.1,
      maxTokens: 2000,
      jsonMode: true,
      reasoningEffort: 'minimal',
    });
    parsed = parseAssistantPayload(retry.content);
  }

  /**
   * If a Bengali or Hindi answer comes back romanised or in English, ask once
   * for the same answer in the correct script. This is a single bounded retry:
   * a second failure is returned as-is rather than looping, and the customer
   * always sees something.
   */
  if (!replyMatchesScript(parsed.reply, language)) {
    logger.warn('assistant reply was not in the expected script, retrying once', { language });
    try {
      const retryMessages: ChatMessage[] = [
        ...messages,
        {
          role: 'user',
          content: `Rewrite your previous reply in ${languageName(language)}. Keep the same facts and the same JSON shape. Do not add information.`,
        },
      ];
      const retry = await chat.complete(retryMessages, {
        temperature: 0.1,
        maxTokens: 2000,
        jsonMode: true,
        reasoningEffort: 'minimal',
      });
      const retryParsed = parseAssistantPayload(retry.content);
      if (replyMatchesScript(retryParsed.reply, language)) {
        parsed = retryParsed;
      }
    } catch (error) {
      // A failed retry must not lose the original answer.
      logger.warn('script retry failed, keeping the original reply', { reason: (error as Error).message });
    }
  }

  const guarded = guardAssistantReply(parsed.reply, language);

  // Only products that really belong to this business (and are live) are ever
  // turned into a cart proposal.
  const proposals = await validateProposals(prisma, business.id, parsed.proposedItems);

  return {
    reply: guarded.reply,
    language,
    proposals,
    matchedProductCount: matched.length,
    structured: parsed.structured,
    guardRewritten: guarded.rewritten,
  };
}

export async function validateProposals(
  prisma: Db,
  businessId: string,
  items: Array<{ productId: string; quantity: number }>,
): Promise<ValidatedProposal[]> {
  if (items.length === 0) return [];
  const ids = [...new Set(items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, businessId, isArchived: false },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const proposals: ValidatedProposal[] = [];
  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      logger.warn('assistant proposed an unknown product id', { businessId, productId: item.productId });
      continue;
    }
    // `Prisma.Decimal` (not the raw string) keeps money arithmetic exact.
    const unitPrice = new Prisma.Decimal(product.price);
    proposals.push({
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPrice: money(unitPrice),
      availability: product.availability,
      availabilityLabel: availabilityLabel(product.availability),
      orderable: isOrderable(product.availability),
      lineTotal: money(unitPrice.mul(item.quantity)),
    });
  }
  return proposals;
}
