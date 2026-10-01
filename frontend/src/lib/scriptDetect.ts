import type { LanguageCode } from './types';

/**
 * Detects the language of TYPED text from its script.
 *
 * This is deliberately conservative:
 *   - Bengali and Devanagari script are unambiguous, so they are detected.
 *   - Latin letters carry NO reliable language signal. "acha" could be
 *     romanised Bengali, romanised Hindi, or English. Guessing would produce
 *     confidently wrong answers, so this returns null and the UI asks the
 *     customer to choose instead.
 *   - A customer browsing in English who types Bengali must get a Bengali
 *     reply, which is why this never consults the UI language.
 */
export interface ScriptDetection {
  /** A language we are confident about, or null when the script is ambiguous. */
  language: LanguageCode | null;
  /** True when Latin letters were present but no script decided the language. */
  ambiguous: boolean;
}

const BENGALI = /[\u0980-\u09FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[A-Za-z]/;

export function detectScriptLanguage(text: string): ScriptDetection {
  const value = String(text ?? '');
  if (value.trim().length === 0) return { language: null, ambiguous: false };

  const bengaliCount = (value.match(new RegExp(BENGALI.source, 'g')) ?? []).length;
  const devanagariCount = (value.match(new RegExp(DEVANAGARI.source, 'g')) ?? []).length;

  // Whichever script has more characters wins. Mixed text is common because
  // product names stay in Latin, so compare counts rather than presence.
  if (bengaliCount > 0 || devanagariCount > 0) {
    if (bengaliCount >= devanagariCount) return { language: 'bn', ambiguous: false };
    return { language: 'hi', ambiguous: false };
  }

  // Pure Latin (possibly with digits/punctuation): we cannot tell English from
  // romanised Bengali or Hindi, so we decline to guess.
  return { language: null, ambiguous: LATIN.test(value) };
}

/** Convenience wrapper for callers that only need the language. */
export function detectLanguageFromText(text: string): LanguageCode | null {
  return detectScriptLanguage(text).language;
}
