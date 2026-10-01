import { badRequest } from '../lib/errors';

export interface ProposedItem {
  productId: string;
  quantity: number;
}

export interface AssistantPayload {
  reply: string;
  language?: string;
  proposedItems: ProposedItem[];
  structured: boolean;
}

const MAX_REPLY_LENGTH = 4000;
const MAX_PROPOSED_ITEMS = 20;

function coerceItem(raw: unknown): ProposedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const productIdRaw = record.product_id ?? record.productId;
  const productId = typeof productIdRaw === 'string' ? productIdRaw.trim() : '';
  if (!productId) return null;
  const quantityRaw = record.quantity ?? 1;
  const quantity = Number(quantityRaw);
  if (!Number.isFinite(quantity) || quantity < 1) return null;
  return { productId, quantity: Math.min(999, Math.floor(quantity)) };
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Parses the model output. If anything is off we fall back to plain text so the
 * customer still gets an answer and no order/cart data is trusted.
 */
export function parseAssistantPayload(content: string): AssistantPayload {
  const raw = String(content ?? '').trim();
  if (!raw) throw badRequest('The assistant returned an empty message.');

  const parsed = extractJsonObject(raw);
  if (parsed && typeof (parsed as Record<string, unknown>).reply === 'string') {
    const record = parsed as Record<string, unknown>;
    const replyText = String(record.reply).trim();
    const itemsRaw = Array.isArray(record.proposed_items)
      ? record.proposed_items
      : Array.isArray(record.proposedItems)
        ? record.proposedItems
        : [];
    const proposedItems = itemsRaw
      .map(coerceItem)
      .filter((item): item is ProposedItem => Boolean(item))
      .slice(0, MAX_PROPOSED_ITEMS);
    return {
      reply: replyText.slice(0, MAX_REPLY_LENGTH),
      language: typeof record.language === 'string' ? record.language : undefined,
      proposedItems,
      structured: true,
    };
  }

  // Plain text answer: never treat it as an order proposal.
  return { reply: raw.slice(0, MAX_REPLY_LENGTH), proposedItems: [], structured: false };
}
