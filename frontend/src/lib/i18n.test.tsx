import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, LANGUAGES, useI18n } from './i18n';
import { LanguageSelector } from '../components/LanguageSelector';
import { STRINGS } from './strings';

function Probe() {
  const { language, t, money } = useI18n();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="explore">{t('nav.explore')}</span>
      <span data-testid="money">{money('1234.5')}</span>
    </div>
  );
}

describe('language selector and i18n', () => {
  it('offers English, Bengali and Hindi', () => {
    render(
      <I18nProvider>
        <LanguageSelector variant="full" />
      </I18nProvider>,
    );
    for (const language of LANGUAGES) {
      expect(screen.getByRole('radio', { name: new RegExp(language.native) })).toBeInTheDocument();
    }
    expect(LANGUAGES.map((entry) => entry.code)).toEqual(['en', 'bn', 'hi']);
  });

  it('changes every visible label when the language changes', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LanguageSelector variant="full" />
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('explore')).toHaveTextContent('Explore');

    await user.click(screen.getByRole('radio', { name: /বাংলা/ }));
    expect(screen.getByTestId('language')).toHaveTextContent('bn');
    expect(screen.getByTestId('explore')).toHaveTextContent('দোকান খুঁজুন');

    await user.click(screen.getByRole('radio', { name: /हिन्दी/ }));
    expect(screen.getByTestId('language')).toHaveTextContent('hi');
    expect(screen.getByTestId('explore')).toHaveTextContent('दुकानें देखें');
  });

  it('persists the chosen language and sets the document language', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <LanguageSelector variant="full" />
        <Probe />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('radio', { name: /বাংলা/ }));
    expect(window.localStorage.getItem('dukaansaathi.language')).toBe('bn');
    expect(document.documentElement.lang).toBe('bn');
  });

  it('restores the stored language on mount', () => {
    window.localStorage.setItem('dukaansaathi.language', 'hi');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('language')).toHaveTextContent('hi');
    expect(screen.getByTestId('explore')).toHaveTextContent('दुकानें देखें');
  });

  it('formats money in the Indian numbering system', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // ₹1,234.50 with the Indian grouping.
    expect(screen.getByTestId('money').textContent).toMatch(/1,234\.50/);
  });

  it('translates the status and review-tag keys the app relies on', () => {
    for (const language of ['en', 'bn', 'hi'] as const) {
      const table = STRINGS[language];
      for (const key of [
        'status.NEW',
        'status.ACCEPTED',
        'status.PREPARING',
        'status.READY_FOR_PICKUP',
        'status.OUT_FOR_DELIVERY',
        'status.COMPLETED',
        'status.CANCELLED',
        'tag.PRODUCT_QUALITY',
        'tag.VALUE',
        'common.row',
      ] as const) {
        expect(table[key], `${language} is missing ${key}`).toBeTruthy();
      }
    }
  });

  it('falls back to English when a translation key is absent', () => {
    // The runtime falls back rather than showing a raw key.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('explore')).toHaveTextContent('Explore');
    warn.mockRestore();
  });
});

describe('i18n interpolation', () => {
  it('substitutes named variables', () => {
    function Interpolated() {
      const { t } = useI18n();
      return <span data-testid="out">{t('explore.resultCount', { count: 7 })}</span>;
    }
    act(() => {
      render(
        <I18nProvider>
          <Interpolated />
        </I18nProvider>,
      );
    });
    expect(screen.getByTestId('out')).toHaveTextContent('7 shops');
  });
});
