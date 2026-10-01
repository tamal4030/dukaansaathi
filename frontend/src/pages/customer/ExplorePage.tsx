import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { useRecentBusinesses } from '../../hooks/useRecentBusinesses';
import { useCart } from '../../providers/CartProvider';
import { AppShell } from '../../components/AppShell';
import { BusinessCard } from '../../components/BusinessCard';
import { EmptyState, ErrorState, LoadingState, Badge } from '../../components/ui';
import type { PublicBusiness } from '../../lib/types';

const CATEGORY_VALUES = [
  'GROCERY_DAILY_ESSENTIALS',
  'FOOD_BEVERAGES',
  'FASHION_TEXTILES',
  'ELECTRONICS_APPLIANCES',
  'HEALTH_PERSONAL_CARE',
  'HOME_HARDWARE',
  'BOOKS_STATIONERY_GIFTS_OTHER',
] as const;

/**
 * Customer directory. Loads every active business from the database and offers
 * search, category filters, All and Recently accessed. Guests need no account.
 */
export function ExplorePage() {
  const { t } = useI18n();
  const { signedIn } = useAuth();
  const cart = useCart();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [view, setView] = useState<'all' | 'recent'>('all');

  const debouncedSearch = useDebounced(search, 300);
  const recent = useRecentBusinesses({ signedIn });

  const state = useAsync(
    () =>
      api.businesses.list({
        search: debouncedSearch || undefined,
        category: category === 'ALL' ? undefined : category,
      }),
    [debouncedSearch, category],
  );

  // Category labels come from /api/meta rather than from whichever businesses
  // happen to be loaded, so the dropdown never shows a raw enum value such as
  // GROCERY_DAILY_ESSENTIALS when the result list is empty or filtered.
  const meta = useAsync(() => api.meta(), []);
  const categoryOptions = useMemo(
    () => meta.data?.categories ?? CATEGORY_VALUES.map((value) => ({ id: value, slug: value, label: value })),
    [meta.data],
  );

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore'), end: true },
      { to: '/orders', label: t('nav.orders') },
      { to: '/account', label: t('nav.account') },
    ],
    [t],
  );

  const businesses: PublicBusiness[] = view === 'recent' ? recent.businesses : (state.data?.businesses ?? []);
  const loading = view === 'recent' ? recent.loading : state.loading;
  const error = view === 'recent' ? null : state.error;

  return (
    <AppShell
      nav={nav}
      title={t('explore.title')}
      subtitle={state.data ? t('explore.resultCount', { count: view === 'recent' ? businesses.length : state.data.total }) : undefined}
      actions={
        cart.count > 0 ? (
          <Badge tone="bg-brand-50 text-brand-700">{t('cart.itemCount', { count: cart.count })}</Badge>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="field-label" htmlFor="explore-search">
                {t('explore.searchLabel')}
              </label>
              <input
                id="explore-search"
                type="search"
                className="input"
                placeholder={t('explore.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="min-w-[180px]">
              <label className="field-label" htmlFor="explore-category">
                {t('explore.categoryLabel')}
              </label>
              <select
                id="explore-category"
                className="input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="ALL">{t('common.all')}</option>
                {categoryOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex gap-2" role="tablist" aria-label={t('explore.categoryLabel')}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'all'}
              className={view === 'all' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setView('all')}
            >
              {t('explore.allShops')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'recent'}
              className={view === 'recent' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setView('recent')}
            >
              {t('explore.recentlyAccessed')}
              {recent.ids.length > 0 ? (
                <span className="rounded-full bg-white/20 px-1.5 text-xs">{recent.ids.length}</span>
              ) : null}
            </button>
          </div>
        </div>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error.message} onRetry={state.reload} /> : null}

        {!loading && !error && businesses.length === 0 ? (
          <EmptyState
            body={view === 'recent' ? t('account.recentNote') : t('state.emptyBusinesses')}
            action={
              view === 'recent' ? (
                <button type="button" className="btn-primary" onClick={() => setView('all')}>
                  {t('explore.allShops')}
                </button>
              ) : undefined
            }
          />
        ) : null}

        {businesses.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.map((business) => (
              <li key={business.id}>
                <BusinessCard business={business} onOpen={() => recent.record(business.id)} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </AppShell>
  );
}
