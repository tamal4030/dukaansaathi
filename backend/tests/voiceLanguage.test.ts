import { describe, expect, it } from 'vitest';
import {
  SARVAM_STT_MODE,
  SARVAM_STT_MODES,
  isSarvamSttMode,
  normalizeSarvamLanguage,
  sarvamConfigFromEnv,
  sarvamLanguageCode,
} from '../src/services/sarvam';
import { languageName, replyMatchesScript, SCRIPT_RANGES } from '../src/services/prompt';
import { renderSystemPrompt } from '../src/services/prompt';

/**
 * Regression tests for the regional voice-language pipeline.
 *
 * The original defect: the UI language was sent as the STT language, so a
 * Bengali speaker browsing in English had their audio forced through an
 * English model and got nonsense back.
 */

describe('Sarvam STT mode is native transcription, never translation', () => {
  it('defaults to the transcribe mode', () => {
    expect(SARVAM_STT_MODE).toBe('transcribe');
  });

  it('knows all documented modes but only accepts transcribe for our pipeline', () => {
    expect([...SARVAM_STT_MODES]).toEqual(['transcribe', 'translate', 'verbatim', 'translit', 'codemix']);
    expect(isSarvamSttMode('transcribe')).toBe(true);
    expect(isSarvamSttMode('nonsense')).toBe(false);
  });

  it('refuses to be configured into a translating mode', () => {
    // A misconfigured environment must not silently return English for
    // Bengali or Hindi speech.
    const config = sarvamConfigFromEnv({ SARVAM_STT_MODE: 'translate', SARVAM_API_KEY_1: 'k'.repeat(20) });
    expect(config.sttMode).toBe('transcribe');
    const translit = sarvamConfigFromEnv({ SARVAM_STT_MODE: 'translit', SARVAM_API_KEY_1: 'k'.repeat(20) });
    expect(translit.sttMode).toBe('transcribe');
  });

  it('uses the documented default STT model', () => {
    const config = sarvamConfigFromEnv({ SARVAM_API_KEY_1: 'k'.repeat(20) });
    expect(config.sttModel).toBe('saaras:v4');
  });
});

describe('detected language normalisation', () => {
  it('maps Sarvam locales onto the app language codes', () => {
    expect(normalizeSarvamLanguage('bn-IN')).toBe('bn');
    expect(normalizeSarvamLanguage('hi-IN')).toBe('hi');
    expect(normalizeSarvamLanguage('en-IN')).toBe('en');
  });

  it('accepts bare language codes and names', () => {
    expect(normalizeSarvamLanguage('bn')).toBe('bn');
    expect(normalizeSarvamLanguage('HI')).toBe('hi');
    expect(normalizeSarvamLanguage('Bengali')).toBe('bn');
    expect(normalizeSarvamLanguage('Hindi')).toBe('hi');
  });

  it('returns null rather than guessing for unknown values', () => {
    for (const value of ['', '   ', null, undefined, 'ta-IN', 'klingon', 'zz']) {
      expect(normalizeSarvamLanguage(value)).toBeNull();
    }
  });

  it('never coerces an unknown detection into English', () => {
    // The whole point: an unrecognised value must not become 'en'.
    expect(normalizeSarvamLanguage('ta-IN')).not.toBe('en');
    expect(normalizeSarvamLanguage('')).not.toBe('en');
  });
});

describe('automatic detection is requested by default', () => {
  it('sends language_code=unknown when no language is chosen', () => {
    expect(sarvamLanguageCode(null)).toBe('unknown');
    expect(sarvamLanguageCode(undefined)).toBe('unknown');
  });

  it('still allows an explicit language when the customer chooses one', () => {
    expect(sarvamLanguageCode('bn')).toBe('bn-IN');
    expect(sarvamLanguageCode('hi')).toBe('hi-IN');
    expect(sarvamLanguageCode('en')).toBe('en-IN');
  });

  it('the UI language is not required to pick the STT language', () => {
    // English interface, Bengali speech: the caller passes null, which yields
    // "unknown" and lets the provider detect Bengali.
    const uiLanguage = 'en';
    const sttLanguage = sarvamLanguageCode(null);
    expect(sttLanguage).toBe('unknown');
    expect(sttLanguage).not.toBe(sarvamLanguageCode(uiLanguage));
  });
});

describe('target language is stated with its script', () => {
  it('names the script for Bengali and Hindi', () => {
    expect(languageName('bn')).toMatch(/Bengali script/i);
    expect(languageName('hi')).toMatch(/Devanagari/i);
    expect(languageName('bn')).toMatch(/not romanised/i);
    expect(languageName('en')).toBe('English');
  });

  it('renders the new prompt with the detected language, not the UI language', () => {
    const prompt = renderSystemPrompt({
      targetLanguage: languageName('bn'),
      businessContext: 'Business ID: biz-1\nName: Sharma Kirana',
      matchedProducts: 'product_id: p1\nname: Atta',
      relevantStoreFacts: 'Store hours: 09:00 - 21:00',
      orderContext: 'No draft cart.',
    });
    expect(prompt).toContain('TARGET_LANGUAGE:');
    expect(prompt).toContain('Bengali script');
    expect(prompt).toContain('Sharma Kirana');
    // The prompt must tell the model to use only supplied context.
    expect(prompt).toContain('Never invent missing facts');
    // And to redirect unrelated questions.
    expect(prompt).toMatch(/unrelated questions/i);
    // No unresolved placeholder may survive.
    expect(prompt).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});

describe('reply script checking', () => {
  it('accepts Bengali text in Bengali script', () => {
    expect(replyMatchesScript('হ্যাঁ, আটা আছে। দাম ২৬৫ টাকা।', 'bn')).toBe(true);
  });

  it('accepts Hindi text in Devanagari', () => {
    expect(replyMatchesScript('हाँ, आटा उपलब्ध है। कीमत 265 रुपये है।', 'hi')).toBe(true);
  });

  it('rejects romanised Bengali so the retry can correct it', () => {
    expect(replyMatchesScript('Hya, atta ache. Dam 265 taka.', 'bn')).toBe(false);
  });

  it('rejects a plain English reply for Bengali', () => {
    expect(replyMatchesScript('Yes, we have atta in stock for Rs 265.', 'bn')).toBe(false);
  });

  it('tolerates Latin product names inside a Bengali reply', () => {
    // Merchant data such as brand names must stay unchanged, so a reply that
    // is mostly Bengali script with a Latin brand name is still acceptable.
    expect(replyMatchesScript('Aashirvaad Atta 5kg আমাদের দোকানে পাওয়া যায়।', 'bn')).toBe(true);
  });

  it('does not constrain English replies', () => {
    expect(replyMatchesScript('Anything at all', 'en')).toBe(true);
  });

  it('exposes the script ranges it uses', () => {
    expect(SCRIPT_RANGES.bn).toBeInstanceOf(RegExp);
    expect(SCRIPT_RANGES.hi).toBeInstanceOf(RegExp);
    expect(SCRIPT_RANGES.en).toBeNull();
  });
});
