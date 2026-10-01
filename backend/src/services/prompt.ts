/**
 * The in-app assistant system prompt. Keep this byte-for-byte aligned with the
 * prompt documented in docs/PLANNING.md.
 *
 * TARGET_LANGUAGE is supplied by the application and comes from the speech
 * detector or the customer's explicit choice. It is NEVER the app's interface
 * language, which is why the placeholder is named that way.
 */
export const SYSTEM_PROMPT_TEMPLATE = `You are DukaanSaathi, a polite and concise assistant for the specific local business in the trusted context below.

LANGUAGE
Use TARGET_LANGUAGE, which comes from the speech detector or the customer's explicit choice\u2014not the app's interface language.
- Bengali: write natural Bengali in Bengali script.
- Hindi: write natural Hindi in Devanagari.
- English: reply in English.
Avoid unnecessary English words or code-mixing in Bengali/Hindi. Preserve exact business names, product/brand names, model numbers, addresses, and identifiers from the supplied data.

SCOPE AND ACCURACY
Answer only questions about this business's listed products, prices, availability, hours, location/contact, delivery or pickup, policies, FAQs, and orders.
Use only the trusted context below. Never invent missing facts or use outside knowledge. \u201cUnknown\u201d availability is not \u201cAvailable.\u201d
If information is missing, say politely that you cannot confirm it and offer to pass the question to the business.
For unrelated questions (such as general maths, literature, or history), briefly and politely explain\u2014in TARGET_LANGUAGE\u2014that you can help with this shop's products, services, and orders.

ORDERS
You may help prepare a cart from the supplied products, but never claim an order has been placed until the application validates it and the customer explicitly confirms it. Do not invent or calculate authoritative prices or totals; the application does that. Never claim payment was received or verified.

Follow the application's existing structured response format. Keep the customer-facing reply in TARGET_LANGUAGE.

TRUSTED CONTEXT
TARGET_LANGUAGE: {{detected_or_selected_language}}
BUSINESS: {{business_context}}
MATCHED PRODUCTS: {{matched_products}}
RELEVANT POLICIES/FAQ: {{relevant_store_facts}}
ORDER/CART CONTEXT: {{order_context}}`;

export interface PromptContext {
  /** The language the customer spoke or chose, not the interface language. */
  targetLanguage: string;
  businessContext: string;
  matchedProducts: string;
  relevantStoreFacts: string;
  orderContext: string;
}

function safeInsert(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() || 'Not available';
}

export function renderSystemPrompt(context: PromptContext): string {
  return SYSTEM_PROMPT_TEMPLATE.replace('{{detected_or_selected_language}}', safeInsert(context.targetLanguage))
    .replace('{{business_context}}', safeInsert(context.businessContext))
    .replace('{{matched_products}}', safeInsert(context.matchedProducts))
    .replace('{{relevant_store_facts}}', safeInsert(context.relevantStoreFacts))
    .replace('{{order_context}}', safeInsert(context.orderContext));
}

/**
 * Structured-output contract, sent as a separate system message so the main
 * prompt stays exactly as specified.
 */
export const OUTPUT_CONTRACT = `OUTPUT FORMAT
Reply with a single JSON object and nothing else, in this exact shape:
{"reply": "<your answer to the customer>", "language": "en" | "bn" | "hi", "proposed_items": [{"product_id": "<id from the matched products list>", "quantity": 1}]}
Rules for the JSON:
- "reply" is the only text the customer sees. Keep it short and polite.
- Use "proposed_items" only when the customer clearly asked for specific products that appear in the matched products list. Otherwise return an empty array.
- Never invent product_id values. Copy them exactly from the matched products list.
- Prices, totals and order placement are handled by the application, never by you.`;

export type LanguageCode = 'en' | 'bn' | 'hi';

export const LANGUAGE_CODES: LanguageCode[] = ['en', 'bn', 'hi'];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LANGUAGE_CODES.includes(value as LanguageCode);
}

/**
 * Human-readable language label for the prompt. The required script is stated
 * explicitly, because "reply in Bengali" alone can produce romanised output.
 */
export function languageName(code: LanguageCode): string {
  switch (code) {
    case 'bn':
      return 'Bengali / বাংলা - write in Bengali script (বাংলা লিপি), not romanised';
    case 'hi':
      return 'Hindi / हिन्दी - write in Devanagari script (देवनागरी), not romanised';
    default:
      return 'English';
  }
}

/**
 * Script ranges used to sanity-check that a reply really is in the requested
 * language. Devanagari U+0900-U+097F; Bengali U+0980-U+09FF.
 */
export const SCRIPT_RANGES: Record<LanguageCode, RegExp | null> = {
  bn: /[\u0980-\u09FF]/,
  hi: /[\u0900-\u097F]/,
  en: null,
};

/**
 * True when the reply looks like it is written in the expected script.
 * Used only for a gentle retry, never to rewrite the model's answer.
 */
export function replyMatchesScript(reply: string, language: LanguageCode): boolean {
  const range = SCRIPT_RANGES[language];
  if (!range) return true;
  const letters = reply.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length === 0) return true;
  const inScript = (reply.match(new RegExp(range.source, 'g')) ?? []).length;
  // Bengali/Hindi answers legitimately contain product names in Latin script,
  // so require a meaningful share rather than every character.
  return inScript / letters.length >= 0.3;
}
