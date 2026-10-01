import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useCart } from '../../providers/CartProvider';
import { AppShell } from '../../components/AppShell';
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { availabilityTone } from '../../lib/format';
import type { Quote } from '../../lib/types';

/**
 * Cart review. Quantities are editable and the total shown comes from the
 * backend quote, which prices every line from PostgreSQL.
 */
export function CartPage() {
  const { t, money } = useI18n();
  const cart = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const lines = cart.lines;
  const businessId = cart.businessId;

  useEffect(() => {
    if (!businessId || lines.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.orders
      .quote(
        businessId,
        lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      )
      .then((result) => {
        if (!cancelled) setQuote(result.quote);
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(problem instanceof Error ? problem : new Error(t('common.somethingWentWrong')));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-quote whenever the cart contents change.
  }, [businessId, lines, t]);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/cart', label: t('cart.title'), badge: cart.count, end: true },
      { to: '/orders', label: t('nav.orders') },
      { to: '/account', label: t('nav.account') },
    ],
    [t, cart.count],
  );

  return (
    <AppShell nav={nav} title={t('cart.title')} subtitle={t('cart.itemCount', { count: cart.count })}>
      {lines.length === 0 ? (
        <EmptyState
          body={t('cart.empty')}
          action={
            <Link to="/explore" className="btn-primary">
              {t('explore.title')}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <ul className="space-y-3">
            {lines.map((line) => {
              const quoted = quote?.lines.find((entry) => entry.productId === line.productId);
              return (
                <li key={line.productId} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-ink">{line.name}</h2>
                      <p className="text-sm text-ink-muted">
                        {money(quoted?.unitPrice ?? line.unitPrice)} × {line.quantity}
                      </p>
                      {quoted ? (
                        <Badge tone={availabilityTone(quoted.availability)}>{quoted.availabilityLabel}</Badge>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`qty-${line.productId}`}>
                        {t('common.quantity')}
                      </label>
                      <input
                        id={`qty-${line.productId}`}
                        type="number"
                        min={1}
                        max={200}
                        className="input w-20 text-center"
                        value={line.quantity}
                        onChange={(event) => cart.setQuantity(line.productId, Number(event.target.value))}
                      />
                      <button
                        type="button"
                        className="btn-danger px-3"
                        onClick={() => cart.remove(line.productId)}
                      >
                        {t('common.remove')}
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 text-right text-sm font-semibold text-ink">
                    {money(quoted?.lineTotal ?? '0')}
                  </p>
                  {quoted?.issue ? <p className="mt-1 text-xs text-amber-800">{quoted.issue}</p> : null}
                </li>
              );
            })}
            <li>
              <button type="button" className="btn-secondary" onClick={cart.clear}>
                {t('cart.clear')}
              </button>
            </li>
          </ul>

          <aside className="card h-fit p-4 lg:sticky lg:top-28">
            <h2 className="text-base font-semibold text-ink">{t('cart.title')}</h2>

            {loading ? <LoadingState label={t('common.loading')} /> : null}
            {error ? <ErrorState message={error.message} /> : null}

            {quote ? (
              <>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">{t('cart.subtotal')}</dt>
                    <dd className="font-semibold text-ink">{money(quote.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-base">
                    <dt className="font-semibold text-ink">{t('common.total')}</dt>
                    <dd className="font-bold text-ink">{money(quote.total)}</dd>
                  </div>
                </dl>

                {quote.issues.length > 0 ? (
                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                    <p className="font-semibold">{t('cart.availabilityWarning')}</p>
                    <ul className="mt-1 list-disc pl-4">
                      {quote.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="mt-3 text-xs text-ink-soft">{t('cart.priceFromShop')}</p>
                <p className="mt-1 text-xs text-ink-soft">{t('checkout.noPayment')}</p>

                <Link
                  to="/checkout"
                  aria-disabled={!quote.canSubmit}
                  className={`btn-primary mt-4 w-full py-3 ${quote.canSubmit ? '' : 'pointer-events-none opacity-50'}`}
                >
                  {t('cart.checkout')}
                </Link>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
