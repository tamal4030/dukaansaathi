import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../providers/ToastProvider';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, EmptyState, ErrorState, LoadingState, SectionHeading, StarRating } from '../../components/ui';
import type { ConversationMessage, MerchantConversation } from '../../lib/types';

export function MerchantConversationsPage() {
  const { t, dateTime } = useI18n();
  const { businessId = '' } = useParams();
  const { push } = useToast();
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('OPEN');
  const [selected, setSelected] = useState<string | null>(null);

  const state = useAsync(
    () => api.merchantConversations.list(businessId, filter === 'ALL' ? undefined : filter),
    [businessId, filter],
  );

  const detail = useAsync<{ conversation: MerchantConversation | null }>(
    () =>
      selected
        ? api.merchantConversations.get(businessId, selected)
        : Promise.resolve({ conversation: null }),
    [businessId, selected],
  );

  return (
    <MerchantGate title={t('merchant.conversations')}>
      {() => (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            <div className="card flex flex-wrap gap-2 p-3">
              {(['OPEN', 'RESOLVED', 'ALL'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  className={filter === value ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
                  onClick={() => setFilter(value)}
                >
                  {value === 'ALL' ? t('common.all') : value === 'OPEN' ? t('common.open') : t('common.resolved')}
                </button>
              ))}
            </div>

            {state.loading ? <LoadingState /> : null}
            {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}
            {!state.loading && (state.data?.conversations.length ?? 0) === 0 ? (
              <EmptyState body={t('state.emptyConversations')} />
            ) : null}

            {state.data && state.data.conversations.length > 0 ? (
              <ul className="space-y-2">
                {state.data.conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`card w-full p-3 text-left hover:shadow-lift ${
                        selected === conversation.id ? 'ring-2 ring-brand-600' : ''
                      }`}
                      onClick={() => setSelected(conversation.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {conversation.customerName ?? t('merchant.guestCustomer')}
                        </span>
                        <Badge tone={conversation.status === 'OPEN' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-700'}>
                          {conversation.status === 'OPEN' ? t('common.open') : t('common.resolved')}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {conversation.isGuest ? t('merchant.guestCustomer') : ''} · {dateTime(conversation.lastMessageAt)}
                      </p>
                      {conversation.messages?.[0] ? (
                        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{conversation.messages[0].content}</p>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <aside className="card h-fit p-4 lg:sticky lg:top-28">
            {!selected ? (
              <p className="text-sm text-ink-muted">{t('merchant.conversations')}</p>
            ) : detail.loading ? (
              <LoadingState />
            ) : detail.data?.conversation ? (
              <>
                <SectionHeading
                  title={detail.data.conversation.customerName ?? t('merchant.guestCustomer')}
                  hint={detail.data.conversation.isGuest ? t('merchant.guestCustomer') : undefined}
                />

                <ol className="mt-2 max-h-[45vh] space-y-3 overflow-y-auto">
                  {(detail.data.conversation.messages ?? []).map((message: ConversationMessage) => (
                    <li key={message.id} className={`flex ${message.role === 'CUSTOMER' ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                          message.role === 'CUSTOMER' ? 'bg-slate-100 text-ink' : 'bg-brand-600 text-white'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        <p className="mt-1 text-[11px] opacity-70">{dateTime(message.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                {detail.data.conversation.feedback ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-ink">{t('merchant.conversationFeedback')}</p>
                    <StarRating value={detail.data.conversation.feedback.rating} readOnly size="sm" />
                    {detail.data.conversation.feedback.comment ? (
                      <p className="text-sm text-ink-muted">{detail.data.conversation.feedback.comment}</p>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="btn-primary mt-4 w-full"
                  onClick={async () => {
                    const next = detail.data!.conversation!.status === 'OPEN' ? 'RESOLVED' : 'OPEN';
                    try {
                      await api.merchantConversations.setStatus(businessId, selected, next);
                      push(next === 'RESOLVED' ? t('merchant.markResolved') : t('merchant.markOpen'), 'success');
                      state.reload();
                      detail.reload();
                    } catch (problem) {
                      push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
                    }
                  }}
                >
                  {detail.data.conversation.status === 'OPEN' ? t('merchant.markResolved') : t('merchant.markOpen')}
                </button>

                <p className="mt-3 text-xs text-ink-soft">{t('merchant.guestCustomer')}: {detail.data.conversation.isGuest ? t('common.yes') : t('common.no')}</p>
              </>
            ) : (
              <ErrorState message={detail.error?.message} />
            )}
          </aside>
        </div>
      )}
    </MerchantGate>
  );
}
