import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { LanguageSelector } from '../components/LanguageSelector';

const CATEGORY_KEYS = [
  'Grocery & daily essentials',
  'Food & beverages',
  'Fashion & textiles',
  'Electronics & appliances',
  'Health & personal care',
  'Home & hardware',
  'Books, stationery, gifts & other/mixed retail',
];

export function LandingPage() {
  const { t } = useI18n();

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only sr-only-focusable">
        {t('app.skipToContent')}
      </a>

      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white"
          >
            द
          </span>
          <span className="text-lg font-bold text-ink">{t('app.name')}</span>
        </span>
        <LanguageSelector />
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-12">
        <section className="card p-6 sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{t('app.name')}</h1>
          <p className="mt-2 text-lg text-brand-700">{t('app.tagline')}</p>

          <div className="mt-6">
            <LanguageSelector variant="full" />
          </div>

          {/* Exactly one primary customer action here. The business-owner path
              lives in its own labelled section below, so it is not duplicated. */}
          <div className="mt-6">
            <Link to="/explore" className="btn-primary w-full py-3 text-base">
              {t('landing.explore')}
            </Link>
            <p className="mt-2 text-sm text-ink-muted">{t('landing.customerNote')}</p>
          </div>
        </section>

        <section className="mt-6" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="mb-3 text-xl font-semibold text-ink">
            {t('landing.howItWorks')}
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {(['1', '2', '3'] as const).map((step) => {
              const title = t(`landing.step${step}Title` as 'landing.step1Title');
              const body = t(`landing.step${step}Body` as 'landing.step1Body');
              return (
                <li key={step} className="card p-4">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                    {step}
                  </span>
                  <h3 className="mt-2 text-base font-semibold text-ink">{title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{body}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-6 card p-6" aria-labelledby="for-businesses">
          <h2 id="for-businesses" className="text-xl font-semibold text-ink">
            {t('landing.forBusinesses')}
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-muted">
            <li>• {t('landing.businessPoint1')}</li>
            <li>• {t('landing.businessPoint2')}</li>
            <li>• {t('landing.businessPoint3')}</li>
          </ul>
          <p className="mt-2 text-sm text-ink-muted">{t('landing.businessNote')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/business/signup" className="btn-primary">
              {t('auth.createBusinessAccount')}
            </Link>
            <Link to="/business/login" className="btn-secondary">
              {t('auth.businessLogin')}
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink-soft">{t('auth.whyGoogle')}</p>
        </section>

        <section className="mt-6" aria-labelledby="categories">
          <h2 id="categories" className="mb-3 text-xl font-semibold text-ink">
            {t('explore.categoryLabel')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {CATEGORY_KEYS.map((label) => (
              <li key={label} className="chip bg-white text-ink-muted shadow-card">
                {label}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
