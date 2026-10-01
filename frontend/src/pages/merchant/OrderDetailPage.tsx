import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../providers/ToastProvider';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, ErrorState, LoadingState, SectionHeading } from '../../components/ui';
import { statusTone } from '../../lib/format';
import { ApiError } from '../../lib/api';
import type { OrderStatus } from '../../lib/types';

/**
 * Merchant order detail. Only the transitions the backend allows for this
 * order's fulfilment type are offered.
 */
export function MerchantOrderDetailPage() {
  const { orderId = '', businessId = '' } = useParams();
  const { t, money, dateTime } = useI18n();
  const { push } = useToast();

  const state = useAsync(() => api.orders.getForMerchant(orderId, businessId), [orderId, businessId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [emailNote, setEmailNote] = useState<string | null>(null);

  return (
    <MerchantGate title={t('merchant.orders')}>
      {() => (
        <>
          {state.loading ? <LoadingState /> : null}
          {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}

          {state.data ? (
            <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
              <div className="space-y-4">
                <section className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold text-ink">{state.data.order.orderCode}</p>
                      <p className="text-sm text-ink-muted">{dateTime(state.data.order.createdAt)}</p>
                    </div>
                    <Badge tone={statusTone(state.data.order.status)}>{state.data.order.statusLabel}</Badge>
                  </div>

                  <SectionHeading title={t('orders.items')} />
                  <ul className="space-y-2 text-sm">
                    {state.data.order.items.map((item) => (
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
                    <dd className="font-bold text-ink">{money(state.data.order.total)}</dd>
                  </dl>
                </section>

                <section className="card p-4">
                  <SectionHeading title={t('merchant.customerDetails')} />
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-ink-muted">{t('merchant.customerName')}</dt>
                      <dd className="text-ink">{state.data.order.customerName}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">{t('merchant.customerPhone')}</dt>
                      <dd className="text-ink">
                        {state.data.order.customerPhone ? (
                          <a href={`tel:${state.data.order.customerPhone}`} className="text-brand-700 underline">
                            {state.data.order.customerPhone}
                          </a>
                        ) : (
                          t('common.notSet')
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">{t('merchant.fulfillment')}</dt>
                      <dd className="text-ink">
                        {state.data.order.fulfillment === 'PICKUP' ? t('checkout.pickup') : t('checkout.delivery')}
                      </dd>
                    </div>
                    {state.data.order.deliveryAddress ? (
                      <div>
                        <dt className="text-ink-muted">{t('merchant.deliveryAddress')}</dt>
                        <dd className="text-ink">{state.data.order.deliveryAddress}</dd>
                      </div>
                    ) : null}
                    {state.data.order.notes ? (
                      <div className="sm:col-span-2">
                        <dt className="text-ink-muted">{t('common.notes')}</dt>
                        <dd className="text-ink">{state.data.order.notes}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                <section className="card p-4">
                  <SectionHeading title={t('orders.statusHistory')} />
                  <ol className="space-y-3">
                    {state.data.order.statusHistory.map((event) => (
                      <li key={event.id} className="flex gap-3">
                        <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600" />
                        <div>
                          <p className="text-sm font-semibold text-ink">{event.statusLabel}</p>
                          <p className="text-xs text-ink-muted">{dateTime(event.createdAt)}</p>
                          {event.note ? <p className="text-xs text-ink-muted">{event.note}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>

              <aside className="card h-fit space-y-3 p-4 lg:sticky lg:top-28">
                <SectionHeading title={t('merchant.updateStatus')} />

                {state.data.nextStatuses.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('merchant.noNextStatuses')}</p>
                ) : (
                  <>
                    <div>
                      <label className="field-label" htmlFor="status-note">
                        {t('merchant.statusNote')}
                      </label>
                      <input
                        id="status-note"
                        className="input"
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </div>

                    <div className="space-y-2">
                      {state.data.nextStatuses.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="btn-primary w-full"
                          disabled={busy !== null}
                          onClick={async () => {
                            setBusy(option.id);
                            setEmailNote(null);
                            try {
                              const result = await api.merchant.updateOrderStatus(
                                state.data!.order.businessId,
                                state.data!.order.id,
                                option.id,
                                note.trim() || undefined,
                              );
                              push(t('merchant.statusUpdated', { status: option.label }), 'success');
                              setEmailNote(
                                result.notifications.customerEmail === 'SENT'
                                  ? t('merchant.emailSentCustomer')
                                  : result.notifications.note,
                              );
                              setNote('');
                              state.reload();
                            } catch (problem) {
                              push(problem instanceof ApiError ? problem.message : t('common.somethingWentWrong'), 'error');
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          {busy === option.id ? t('common.saving') : option.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {emailNote ? <p className="text-xs text-ink-muted">{emailNote}</p> : null}

                <Link to="/merchant" className="btn-secondary w-full">
                  {t('common.back')}
                </Link>
              </aside>
            </div>
          ) : null}
        </>
      )}
    </MerchantGate>
  );
}
