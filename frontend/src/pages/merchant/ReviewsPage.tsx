import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, EmptyState, ErrorState, LoadingState, SectionHeading, StarRating, StatTile } from '../../components/ui';

export function MerchantReviewsPage() {
  const { t, date } = useI18n();
  const { businessId = '' } = useParams();
  const state = useAsync(() => api.merchant.reviews(businessId), [businessId]);

  return (
    <MerchantGate title={t('nav.reviews')}>
      {() => (
        <>
          {state.loading ? <LoadingState /> : null}
          {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}

          {state.data ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile
                  label={t('merchant.avgRating')}
                  value={state.data.rating.average !== null ? `${state.data.rating.average} / 5` : t('business.noRating')}
                />
                <StatTile label={t('merchant.completedOrders')} value={state.data.rating.count} />
              </div>

              <section>
                <SectionHeading title={t('merchant.recentReviews')} />
                {state.data.reviews.length === 0 ? (
                  <EmptyState body={t('state.emptyReviews')} />
                ) : (
                  <ul className="space-y-2">
                    {state.data.reviews.map((review) => (
                      <li key={review.id} className="card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StarRating value={review.rating} readOnly size="sm" />
                          {/* The source of every rating is shown explicitly. */}
                          <Badge>{t('merchant.reviewSourceOrder')}</Badge>
                        </div>
                        {review.comment ? <p className="mt-1 text-sm text-ink">{review.comment}</p> : null}
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {review.tags.map((tag) => (
                            <li key={tag} className="chip bg-slate-100 text-slate-700">
                              {t(`tag.${tag}` as 'tag.VALUE')}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1 text-xs text-ink-soft">{date(review.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <SectionHeading title={t('merchant.conversationFeedback')} />
                {state.data.conversationFeedback.length === 0 ? (
                  <p className="card p-4 text-sm text-ink-muted">{t('state.emptyConversations')}</p>
                ) : (
                  <ul className="space-y-2">
                    {state.data.conversationFeedback.map((entry) => (
                      <li key={entry.id} className="card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StarRating value={entry.rating} readOnly size="sm" />
                          <Badge>{t('merchant.reviewSourceConversation')}</Badge>
                        </div>
                        {entry.comment ? <p className="mt-1 text-sm text-ink">{entry.comment}</p> : null}
                        <p className="mt-1 text-xs text-ink-soft">{date(entry.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}
    </MerchantGate>
  );
}
