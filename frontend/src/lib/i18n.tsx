import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LanguageCode } from './types';
import { STRINGS, type StringKey } from './strings';

const STORAGE_KEY = 'dukaansaathi.language';

export const LANGUAGES: Array<{ code: LanguageCode; label: string; native: string }> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return value === 'en' || value === 'bn' || value === 'hi';
}

function readStoredLanguage(): LanguageCode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;
    // Fall back to the browser language when it is one we support.
    const browser = window.navigator.language?.slice(0, 2);
    if (isLanguageCode(browser)) return browser;
  } catch {
    // localStorage can be unavailable (private mode); English is a safe default.
  }
  return 'en';
}

interface I18nValue {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Formats a rupee amount using the Indian numbering system. */
  money: (value: string | number) => string;
  date: (value: string) => string;
  dateTime: (value: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() =>
    typeof window === 'undefined' ? 'en' : readStoredLanguage(),
  );

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Ignore storage failures; the in-memory value still applies.
    }
  }, [language]);

  const setLanguage = useCallback((next: LanguageCode) => setLanguageState(next), []);

  const value = useMemo<I18nValue>(() => {
    const locale = language === 'en' ? 'en-IN' : language === 'bn' ? 'bn-IN' : 'hi-IN';

    const t = (key: StringKey, vars?: Record<string, string | number>) => {
      const table = STRINGS[language] ?? STRINGS.en;
      let text = table[key] ?? STRINGS.en[key] ?? String(key);
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
        }
      }
      return text;
    };

    return {
      language,
      setLanguage,
      t,
      money: (input) => {
        const numeric = Number(input);
        if (!Number.isFinite(numeric)) return '₹0.00';
        return new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          minimumFractionDigits: 2,
        }).format(numeric);
      },
      date: (input) => {
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) return '';
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
      },
      dateTime: (input) => {
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) return '';
        return new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }).format(parsed);
      },
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}
