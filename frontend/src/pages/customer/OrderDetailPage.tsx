import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../providers/ToastProvider';
import { AppShell } from '../../components/AppShell';
import { Badge, ErrorState, LoadingState, SectionHeading, StarRating } from '../../components/ui';
import { statusTone } from '../../lib/format';

const REVIEW_TAG_KEYS = [
  'PRODUCT_QUALITY',
  'COMMUNICATION',
  'PACKAGING',
  'VALUE',
  'DELIVERY_PICKUP',
] as const;

/**
 * Order detail. Status is read fresh from the database on every visit, and the
 * customer can refresh manually. Reviews are offered only for completed orders.
 */
export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { t, money, dateTime } = useI18n();
  const { push } = useToast();

  const state = useAsync(() => api.orders.get(orderId), [orderId]);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/orders', label: t('nav.orders'), end: true },
      { to: '/account', label: t('nav.account') },
    ],
    [t],
  );

  const order = state.data?.order;

  const submitReview = async () => {
    if (!order) return;
    setSubmitting(true);
    try {
      await api.orders.review(order.id, { rating, comment: comment.trim() || undefined, tags });
      push(t('orders.reviewSubmitted'), 'success');
      state.reload();
    } catch (problem) {
      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      nav={nav}
      title={order ? t('orders.orderCode', { code: order.orderCode }) : t('orders.title')}
      subtitle={order?.business?.name}
      actions={
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={state.reload}>
            {t('common.refresh')}
          </button>
          <Link to="/orders" className="btn-ghost">
            {t('common.back')}
          </Link>
        </div>
      }
    >
      {state.loading ? <LoadingState /> : null}
      {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}

      {order ? (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-4">
            <section className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={statusTone(order.status)}>{order.statusLabel}</Badge>
                <span className="text-sm text-ink-muted">
                  {order.fulfillment === 'PICKUP' ? t('checkout.pickup') : t('checkout.delivery')}
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-soft">{t('orders.refreshHint')}</p>

              <SectionHeading title={t('orders.items')} />
              <ul className="space-y-2 text-sm">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3">
                    <span className="text-ink">
                      {item.name} × {item.quantity}
                    </span>
                    <span className="font-medium text-ink">{money(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-base">
                <dt className="font-semibold text-ink">{t('common.total')}</dt>
                <dd className="font-bold text-ink">{money(order.total)}</dd>
              </dl>
              <p className="mt-2 text-xs text-ink-soft">{t('checkout.noPayment')}</p>
            </section>

            <section className="card p-4">
              <SectionHeading title={t('merchant.customerDetails')} />
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">{t('checkout.phone')}</dt>
                  <dd className="text-ink">{order.customerPhone ?? t('common.notSet')}</dd>
                </div>
                {order.deliveryAddress ? (
                  <div>
                    <dt className="text-ink-muted">{t('checkout.address')}</dt>
                    <dd className="text-ink">{order.deliveryAddress}</dd>
                  </div>
                ) : null}
                {order.notes ? (
                  <div>
                    <dt className="text-ink-muted">{t('checkout.notes')}</dt>
                    <dd className="text-ink">{order.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {state.data?.business.publicPhone ? (
              <a href={`tel:${state.data.business.publicPhone}`} className="btn-secondary w-full">
                {t('orders.contactShop')} · {state.data.business.publicPhone}
              </a>
            ) : null}
          </div>

          <div className="space-y-4">
            <section className="card p-4">
              <SectionHeading title={t('orders.statusHistory')} />
              <ol className="space-y-3">
                {order.statusHistory.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600"
                    />
                    <div>
                      <p className="text-sm font-semibold text-ink">{event.statusLabel}</p>
                      <p className="text-xs text-ink-muted">{dateTime(event.createdAt)}</p>
                      {event.note ? <p className="text-xs text-ink-muted">{event.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {order.review ? (
              <section className="card p-4">
                <SectionHeading title={t('orders.reviewOrder')} />
                <StarRating value={order.review.rating} readOnly size="sm" />
                {order.review.comment ? <p className="mt-1 text-sm text-ink">{order.review.comment}</p> : null}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {order.review.tags.map((tag) => (
                    <li key={tag} className="chip bg-slate-100 text-slate-700">
                      {t(`tag.${tag}` as 'tag.VALUE')}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {order.status === 'COMPLETED' && !order.review ? (
              <section className="card p-4">
                <SectionHeading title={t('orders.reviewOrder')} hint={t('orders.reviewSubmitted')} />
                <StarRating value={rating} onChange={setRating} />

                <fieldset className="mt-3">
                  <legend className="field-label">{t('orders.tags')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {REVIEW_TAG_KEYS.map((tag) => {
                      const active = tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          className={active ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
                          onClick={() =>
                            setTags((current) =>
                              active ? current.filter((entry) => entry !== tag) : [...current, tag],
                            )
                          }
                        >
                          {t(`tag.${tag}` as 'tag.VALUE')}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="mt-3">
                  <label className="field-label" htmlFor="review-comment">
                    {t('orders.comment')}
                  </label>
                  <textarea
                    id="review-comment"
                    className="input min-h-[96px]"
                    maxLength={1000}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <p className="field-hint">{t('orders.commentHint')}</p>
                </div>

                <button
                  type="button"
                  className="btn-primary mt-3 w-full"
                  disabled={submitting}
                  onClick={() => void submitReview()}
                >
                  {submitting ? t('common.saving') : t('orders.submitReview')}
                </button>
              </section>
            ) : null}

            {order.status !== 'COMPLETED' && !order.review ? (
              <p className="card p-4 text-sm text-ink-muted">{t('orders.reviewLocked')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
