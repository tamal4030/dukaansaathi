import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { addressLine, formatTime, openStateTone } from '../../lib/format';
import { useRecentBusinesses } from '../../hooks/useRecentBusinesses';
import { useAuth } from '../../providers/AuthProvider';
import { useCart } from '../../providers/CartProvider';
import { useToast } from '../../providers/ToastProvider';
import { AppShell } from '../../components/AppShell';
import { ChatPanel } from '../../components/ChatPanel';
import { ProductCard } from '../../components/ProductCard';
import { Badge, EmptyState, ErrorState, LoadingState, SectionHeading, StarRating } from '../../components/ui';

export function BusinessPage() {
  const { slug = '' } = useParams();
  const { t, date } = useI18n();
  const { signedIn } = useAuth();
  const cart = useCart();
  const { push } = useToast();
  const recent = useRecentBusinesses({ signedIn });

  const [productSearch, setProductSearch] = useState('');
  const [addedId, setAddedId] = useState<string | null>(null);

  const debouncedProductSearch = useDebounced(productSearch, 300);

  const businessState = useAsync(() => api.businesses.get(slug), [slug]);
  const business = businessState.data?.business;

  const productsState = useAsync(
    () => api.businesses.products(slug, { search: debouncedProductSearch || undefined }),
    [slug, debouncedProductSearch],
  );

  // Remember this shop for the "Recently accessed" view. This is a side effect
  // (it may POST to /account/recent), so it belongs in an effect: React is free
  // to re-run or discard a useMemo body, which would duplicate the request.
  const remembered = useRef<string | null>(null);
  useEffect(() => {
    if (!business?.id || remembered.current === business.id) return;
    remembered.current = business.id;
    cart.setBusiness(business.id);
    recent.record(business.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/cart', label: t('cart.title'), badge: cart.count },
      { to: '/orders', label: t('nav.orders') },
      { to: '/account', label: t('nav.account') },
    ],
    [t, cart.count],
  );

  if (businessState.loading) {
    return (
      <AppShell nav={nav}>
        <LoadingState />
      </AppShell>
    );
  }

  if (businessState.error || !business) {
    return (
      <AppShell nav={nav}>
        <ErrorState message={businessState.error?.message} onRetry={businessState.reload} />
      </AppShell>
    );
  }

  const location = addressLine(business.address);
  const openLabel =
    business.openState === 'open'
      ? t('explore.openNow')
      : business.openState === 'closed'
        ? t('explore.closedNow')
        : t('explore.hoursUnknown');

  return (
    <AppShell
      nav={nav}
      title={business.name}
      subtitle={business.categoryLabel}
      actions={
        cart.count > 0 ? (
          <Link to="/cart" className="btn-primary">
            {t('cart.checkout')} · {cart.count}
          </Link>
        ) : undefined
      }
    >
      {/* Quick navigation so products and chat are one tap away on mobile,
          instead of sitting below every policy, FAQ and review. */}
      <nav
        aria-label={t('business.quickNav')}
        className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden"
      >
        <a href="#store-catalog" className="btn-secondary shrink-0">
          {t('business.catalog')}
        </a>
        <a href="#chat-heading" className="btn-secondary shrink-0">
          {t('business.askShop')}
        </a>
        <a href="#store-info" className="btn-secondary shrink-0">
          {t('business.storeInformation')}
        </a>
      </nav>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-5">
          <section className="card p-4" id="store-info" aria-labelledby="about-heading">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={openStateTone(business.openState)}>{openLabel}</Badge>
              {business.deliveryEnabled ? (
                <Badge tone="bg-brand-50 text-brand-700">{t('business.delivery')}</Badge>
              ) : (
                <Badge>{t('business.noDelivery')}</Badge>
              )}
              {business.pickupEnabled ? <Badge>{t('business.pickup')}</Badge> : <Badge>{t('business.noPickup')}</Badge>}
            </div>

            <h2 id="about-heading" className="mt-3 text-base font-semibold text-ink">
              {t('business.about')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">{business.description ?? t('common.notSet')}</p>

            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-medium text-ink">{t('business.address')}</dt>
                <dd className="text-ink-muted">
                  {location || t('common.notSet')}
                  {business.address.latitude !== null && business.address.longitude !== null ? (
                    <a
                      className="ml-2 text-brand-700 underline"
                      href={`https://www.openstreetmap.org/?mlat=${business.address.latitude}&mlon=${business.address.longitude}#map=17/${business.address.latitude}/${business.address.longitude}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t('merchant.locationPin')}
                    </a>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">{t('business.contact')}</dt>
                <dd className="text-ink-muted">
                  {business.publicPhone ? (
                    <a href={`tel:${business.publicPhone}`} className="text-brand-700 underline">
                      {business.publicPhone}
                    </a>
                  ) : (
                    t('common.notSet')
                  )}
                </dd>
              </div>
              {business.hours.length > 0 ? (
                <div>
                  <dt className="font-medium text-ink">{t('business.hours')}</dt>
                  <dd className="text-ink-muted">
                    <ul className="mt-1 space-y-0.5">
                      {business.hours.map((hour) => (
                        <li key={hour.dayOfWeek} className="flex justify-between gap-3">
                          <span>{hour.day}</span>
                          <span>
                            {hour.isClosed
                              ? t('business.closedToday')
                              : `${formatTime(hour.openTime)} – ${formatTime(hour.closeTime)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : (
                <div>
                  <dt className="font-medium text-ink">{t('business.hours')}</dt>
                  <dd className="text-ink-muted">{t('explore.hoursUnknown')}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="order-3 card p-4 lg:order-none" aria-labelledby="options-heading">
            <h2 id="options-heading" className="text-base font-semibold text-ink">
              {t('business.options')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {business.deliveryNotes ?? (business.deliveryEnabled ? t('business.delivery') : t('business.noDelivery'))}
            </p>

            <h3 className="mt-3 text-sm font-semibold text-ink">{t('business.paymentMethods')}</h3>
            {business.paymentMethods.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-2">
                {business.paymentMethods.map((method) => (
                  <li key={method} className="chip bg-slate-100 text-slate-700">
                    {method}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">{t('common.notSet')}</p>
            )}
            <p className="mt-2 text-xs text-ink-soft">{t('business.paymentNote')}</p>

            <h3 className="mt-3 text-sm font-semibold text-ink">{t('business.returnPolicy')}</h3>
            <p className="text-sm text-ink-muted">{business.returnPolicy ?? t('common.notSet')}</p>
          </section>

          {business.faqs.length > 0 ? (
            <section className="card p-4" aria-labelledby="faq-heading">
              <h2 id="faq-heading" className="text-base font-semibold text-ink">
                {t('business.faqs')}
              </h2>
              <dl className="mt-2 divide-y divide-slate-100">
                {business.faqs.map((faq) => (
                  <div key={faq.id} className="py-2">
                    <dt className="text-sm font-medium text-ink">{faq.question}</dt>
                    <dd className="text-sm text-ink-muted">{faq.answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {businessState.data && businessState.data.reviews.length > 0 ? (
            <section className="card p-4" aria-labelledby="reviews-heading">
              <SectionHeading
                title={t('business.reviews')}
                hint={
                  businessState.data.rating.average !== null
                    ? t('business.ratingSummary', {
                        rating: businessState.data.rating.average,
                        count: businessState.data.rating.count,
                      })
                    : t('business.noRating')
                }
              />
              <ul className="space-y-3">
                {businessState.data.reviews.map((review) => (
                  <li key={review.id} className="rounded-xl bg-slate-50 p-3">
                    <StarRating value={review.rating} readOnly size="sm" />
                    {review.comment ? <p className="mt-1 text-sm text-ink">{review.comment}</p> : null}
                    <p className="mt-1 text-xs text-ink-soft">{date(review.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="order-2 lg:order-none" id="store-catalog" aria-labelledby="catalog-heading">
            <SectionHeading
              id="catalog-heading"
              title={t('business.catalog')}
              hint={t('cart.priceFromShop')}
              action={
                <div className="w-full sm:w-64">
                  <label className="sr-only" htmlFor="product-search">
                    {t('business.catalogSearch')}
                  </label>
                  <input
                    id="product-search"
                    type="search"
                    className="input"
                    placeholder={t('business.catalogSearch')}
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                  />
                </div>
              }
            />

            {productsState.loading ? <LoadingState /> : null}
            {productsState.error ? <ErrorState message={productsState.error.message} onRetry={productsState.reload} /> : null}
            {!productsState.loading && !productsState.error && (productsState.data?.products.length ?? 0) === 0 ? (
              <EmptyState body={t('state.emptyProducts')} />
            ) : null}

            {productsState.data && productsState.data.products.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {productsState.data.products.map((product) => (
                  <li key={product.id}>
                    <ProductCard
                      product={product}
                      added={addedId === product.id}
                      onAdd={
                        business.pickupEnabled || business.deliveryEnabled
                          ? (item) => {
                              cart.add({
                                productId: item.id,
                                name: item.name,
                                unitPrice: item.price,
                                availability: item.availability,
                              });
                              setAddedId(item.id);
                              window.setTimeout(() => setAddedId(null), 1500);
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          <ChatPanel businessId={business.id} businessName={business.name} />
          <button
            type="button"
            className="btn-secondary mt-3 w-full"
            onClick={() => push(t('business.askShop'), 'info')}
          >
            {t('business.askShop')}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
