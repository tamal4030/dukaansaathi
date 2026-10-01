import { useI18n, LANGUAGES } from '../lib/i18n';
import type { LanguageCode } from '../lib/types';

/**
 * Language selection for English, Bengali and Hindi. The choice drives every
 * label through the i18n layer and is sent to the backend for chat and speech
 * (en-IN / bn-IN / hi-IN).
 */
export function LanguageSelector({ variant = 'compact' }: { variant?: 'compact' | 'full' }) {
  const { language, setLanguage, t } = useI18n();

  if (variant === 'full') {
    return (
      <fieldset>
        <legend className="field-label">{t('app.chooseLanguage')}</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('app.languageLabel')}>
          {LANGUAGES.map((option) => {
            const selected = option.code === language;
            return (
              <button
                key={option.code}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLanguage(option.code as LanguageCode)}
                className={`min-h-touch rounded-xl border px-3 py-2 text-center text-sm font-semibold transition ${
                  selected
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-ink hover:bg-slate-50'
                }`}
              >
                <span className="block">{option.native}</span>
                <span className="block text-xs font-normal text-ink-muted">{option.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('app.languageLabel')}</span>
      <span aria-hidden="true" className="text-ink-muted">
        🌐
      </span>
      <select
        className="input min-h-touch w-auto py-2 pr-8 text-sm"
        value={language}
        onChange={(event) => setLanguage(event.target.value as LanguageCode)}
        aria-label={t('app.languageLabel')}
      >
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.native}
          </option>
        ))}
      </select>
    </label>
  );
}
