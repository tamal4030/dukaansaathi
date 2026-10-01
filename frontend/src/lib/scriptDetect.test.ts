import { describe, expect, it } from 'vitest';
import { detectLanguageFromText, detectScriptLanguage } from './scriptDetect';

/**
 * Typed-text language detection.
 *
 * The defect these cover: Bengali typed while the UI was English was answered
 * in English, because the reply language came from the interface instead of the
 * text the customer actually wrote.
 */
describe('script detection for typed text', () => {
  it('detects Bengali script regardless of the UI language', () => {
    expect(detectLanguageFromText('আপনার দোকানে চাল আছে কি?')).toBe('bn');
    expect(detectLanguageFromText('দাম কত?')).toBe('bn');
  });

  it('detects Devanagari as Hindi', () => {
    expect(detectLanguageFromText('आपकी दुकान में चावल है क्या?')).toBe('hi');
    expect(detectLanguageFromText('कीमत क्या है?')).toBe('hi');
  });

  it('prefers the script with more characters in mixed text', () => {
    // Product names stay in Latin, so mixed text is normal.
    expect(detectLanguageFromText('Aashirvaad Atta 5kg এর দাম কত?')).toBe('bn');
    expect(detectLanguageFromText('Aashirvaad Atta 5kg की कीमत क्या है?')).toBe('hi');
  });

  it('declines to guess for Latin-only text and flags it as ambiguous', () => {
    // "acha" could be romanised Bengali, romanised Hindi, or English. Guessing
    // would give a confidently wrong answer.
    for (const text of ['acha', 'kitna', 'do you have rice', 'Atta 5kg price?']) {
      const result = detectScriptLanguage(text);
      expect(result.language).toBeNull();
      expect(result.ambiguous).toBe(true);
    }
  });

  it('reports no ambiguity for empty input', () => {
    expect(detectScriptLanguage('')).toEqual({ language: null, ambiguous: false });
    expect(detectScriptLanguage('   ')).toEqual({ language: null, ambiguous: false });
  });

  it('ignores digits and punctuation', () => {
    expect(detectLanguageFromText('265 টাকা?')).toBe('bn');
    expect(detectLanguageFromText('265 रुपये?')).toBe('hi');
    expect(detectLanguageFromText('265')).toBeNull();
  });

  it('never returns the interface language as a guess', () => {
    // The function has no access to the UI locale at all, which is the point.
    expect(detectLanguageFromText('acha')).not.toBe('en');
    expect(detectLanguageFromText('kitna')).not.toBe('en');
  });
});
