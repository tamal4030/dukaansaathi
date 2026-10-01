import type { LanguageCode } from './prompt';

/**
 * The model must never claim that an order was placed or that a payment was
 * received: only the application can do that. This guard rewrites such claims.
 */
const ORDER_CLAIM_PATTERNS: RegExp[] = [
  /\border\s+(?:has been|is|was)\s+(?:placed|confirmed|created|submitted)\b/i,
  /\bi\s*(?:have|'ve)\s+(?:placed|confirmed|created|submitted)\s+(?:your|the)\s+order\b/i,
  /\byour\s+order\s+(?:is|has been)\s+(?:confirmed|placed|accepted)\b/i,
  /\bupay\s+kora\s+hoyeche\b/i,
  /অর্ডার(?:টি)?\s*(?:দেওয়া হয়েছে|নিশ্চিত করা হয়েছে|কনফার্ম হয়েছে)/,
  /অর্ডার\s*(?:করা হয়েছে|দিয়ে দেওয়া হয়েছে)/,
  /ऑर्डर\s*(?:दिया गया है|लग गया है|कन्फर्म हो गया है|प्लेस हो गया है)/,
  /ऑर्डर\s*(?:हो गया|कर दिया गया)/,
];

const PAYMENT_CLAIM_PATTERNS: RegExp[] = [
  /\bpayment\s+(?:has been|was|is)\s+(?:received|verified|confirmed|successful)\b/i,
  /\bpaid\s+successfully\b/i,
  /পেমেন্ট\s*(?:পেয়ে গেছি|নিশ্চিত হয়েছে|সফল হয়েছে)/,
  /भुगतान\s*(?:प्राप्त हो गया है|सत्यापित हो गया है|सफल हो गया है)/,
];

const REPLACEMENTS: Record<LanguageCode, { order: string; payment: string }> = {
  en: {
    order:
      'I have not placed any order. Your request is only saved as a draft: please review the cart in the app and confirm there to place the order.',
    payment:
      'I cannot confirm any payment. DukaanSaathi does not process payments in this version - the business will tell you how to pay.',
  },
  bn: {
    order:
      'আমি কোনো অর্ডার দিতে পারি না। আপনার অনুরোধ শুধু ড্রাফট হিসেবে রাখা হয়েছে - অ্যাপে কার্ট দেখে নিশ্চিত করলেই অর্ডার তৈরি হবে।',
    payment:
      'পেমেন্ট সম্পর্কে আমি নিশ্চিত করতে পারি না। এই সংস্করণে DukaanSaathi পেমেন্ট প্রসেস করে না - কীভাবে দিতে হবে তা দোকানই জানাবে।',
  },
  hi: {
    order:
      'मैं कोई ऑर्डर नहीं दे सकता। आपका अनुरोध सिर्फ़ ड्राफ़्ट के रूप में रखा गया है - ऐप में कार्ट देखकर पुष्टि करने पर ही ऑर्डर बनेगा।',
    payment:
      'मैं भुगतान की पुष्टि नहीं कर सकता। इस संस्करण में DukaanSaathi भुगतान प्रोसेस नहीं करता - भुगतान कैसे करना है यह दुकान बताएगी।',
  },
};

export interface GuardResult {
  reply: string;
  rewritten: boolean;
}

export function guardAssistantReply(reply: string, language: LanguageCode): GuardResult {
  let output = reply;
  let rewritten = false;

  for (const pattern of ORDER_CLAIM_PATTERNS) {
    if (pattern.test(output)) {
      output = output.replace(pattern, REPLACEMENTS[language].order);
      rewritten = true;
    }
  }
  for (const pattern of PAYMENT_CLAIM_PATTERNS) {
    if (pattern.test(output)) {
      output = output.replace(pattern, REPLACEMENTS[language].payment);
      rewritten = true;
    }
  }

  return { reply: output, rewritten };
}
