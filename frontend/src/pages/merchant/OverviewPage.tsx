import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useParams } from 'react-router-dom';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, ErrorState, LoadingState, SectionHeading, StarRating, StatTile } from '../../components/ui';
import { statusTone } from '../../lib/format';

export function OverviewPage() {
  const { t } = useI18n();
  const { businessId } = useParams();
  const navigate = useNavigate();

  return (
    <MerchantGate title={t('merchant.overview')}>
      {({ business, reload: _reload }) => (
        <OverviewBody businessId={businessId ?? business.id} onOpenOrder={(id) => navigate(`/merchant/${business.id}/orders/${id}`)} />
      )}
    </MerchantGate>
  );
}

function OverviewBody({ businessId, onOpenOrder }: { businessId: string; onOpenOrder: (orderId: string) => void }) {
  const { t, money, date } = useI18n();
  const state = useAsync(() => api.merchant.overview(businessId), [businessId]);

  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return null;

  const data = state.data;

  return (
    <div className="space-y-5">
      <section aria-labelledby="attention">
        <SectionHeading title={t('merchant.needsAttention')} />
        {data.needsAttention.total === 0 ? (
          <p className="card p-4 text-sm text-ink-muted">{t('merchant.nothingNeedsAttention')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label={t('merchant.newOrders')}
              value={data.needsAttention.newOrders}
              tone={data.needsAttention.newOrders > 0 ? 'text-brand-700' : 'text-ink'}
            />
            <StatTile
              label={t('merchant.openConversations')}
              value={data.needsAttention.openConversations}
              tone={data.needsAttention.openConversations > 0 ? 'text-amber-700' : 'text-ink'}
            />
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t('merchant.inProgress')} value={data.inProgressOrders} />
          <StatTile label={t('merchant.completedOrders')} value={data.completedOrders} />
          <StatTile
            label={t('merchant.avgRating')}
            value={data.rating.average !== null ? `${data.rating.average} / 5` : t('business.noRating')}
          />
        </div>
      </section>

      <section aria-labelledby="top-products">
        <SectionHeading title={t('merchant.topProducts')} hint={t('merchant.topProductsHint')} />
        {data.topProducts.length === 0 ? (
          <p className="card p-4 text-sm text-ink-muted">{t('merchant.topProductsEmpty')}</p>
        ) : (
          <ul className="card divide-y divide-slate-100 p-2">
            {data.topProducts.map((product) => (
              <li key={product.name} className="flex items-center justify-between gap-3 px-2 py-2.5">
                <span className="text-sm font-medium text-ink">{product.name}</span>
                <span className="text-sm text-ink-muted">
                  {product.quantitySold} · {money(product.revenue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="availability">
        <SectionHeading title={t('merchant.availabilityBreakdown')} />
        <ul className="grid gap-3 sm:grid-cols-3">
          {data.productAvailability.map((entry) => (
            <li key={entry.value}>
              <StatTile label={entry.label} value={entry.count} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-orders">
        <SectionHeading
          title={t('merchant.recentOrders')}
          action={
            <Link to={`/merchant/${businessId}/orders`} className="btn-secondary">
              {t('common.viewAll')}
            </Link>
          }
        />
        {data.recentOrders.length === 0 ? (
          <p className="card p-4 text-sm text-ink-muted">{t('state.emptyMerchantOrders')}</p>
        ) : (
          <ul className="space-y-2">
            {data.recentOrders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  className="card flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:shadow-lift"
                  onClick={() => onOpenOrder(order.id)}
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink">{order.orderCode}</span>
                    <span className="block text-xs text-ink-muted">
                      {order.customerName} · {date(order.createdAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge tone={statusTone(order.status)}>{order.statusLabel}</Badge>
                    <span className="text-sm font-semibold text-ink">{money(order.total)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reviews">
        <SectionHeading
          title={t('merchant.recentReviews')}
          hint={data.rating.count > 0 ? t('business.ratingSummary', { rating: data.rating.average ?? 0, count: data.rating.count }) : undefined}
          action={
            <Link to={`/merchant/${businessId}/reviews`} className="btn-secondary">
              {t('common.viewAll')}
            </Link>
          }
        />
        {data.recentReviews.length === 0 ? (
          <p className="card p-4 text-sm text-ink-muted">{t('state.emptyReviews')}</p>
        ) : (
          <ul className="space-y-2">
            {data.recentReviews.map((review) => (
              <li key={review.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <StarRating value={review.rating} readOnly size="sm" />
                  <Badge>{t('merchant.reviewSourceOrder')}</Badge>
                </div>
                {review.comment ? <p className="mt-1 text-sm text-ink">{review.comment}</p> : null}
                <p className="mt-1 text-xs text-ink-soft">{date(review.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
