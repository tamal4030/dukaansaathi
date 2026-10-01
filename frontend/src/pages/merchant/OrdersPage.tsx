import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { MerchantGate } from '../../components/MerchantGate';
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { statusTone } from '../../lib/format';
import type { OrderStatus } from '../../lib/types';

const STATUSES: Array<OrderStatus | 'ALL'> = [
  'ALL',
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
];

export function MerchantOrdersPage() {
  const { t, money, dateTime } = useI18n();
  const { businessId = '' } = useParams();
  const [status, setStatus] = useState<OrderStatus | 'ALL'>('ALL');

  const state = useAsync(() => api.merchant.orders(businessId, status), [businessId, status]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    state.data?.counts.forEach((entry) => map.set(entry.status, entry._count._all));
    return map;
  }, [state.data]);

  return (
    <MerchantGate title={t('merchant.orders')}>
      {() => (
        <div className="space-y-4">
          <div className="card p-3">
            <p className="field-label">{t('merchant.filterStatus')}</p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={status === value}
                  className={status === value ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
                  onClick={() => setStatus(value)}
                >
                  {value === 'ALL' ? t('common.all') : t(`status.${value}` as 'status.NEW')}
                  {value !== 'ALL' && counts.get(value) ? (
                    <span className="rounded-full bg-white/25 px-1.5">{counts.get(value)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {state.loading ? <LoadingState /> : null}
          {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}

          {!state.loading && (state.data?.orders.length ?? 0) === 0 ? (
            <EmptyState body={t('state.emptyMerchantOrders')} />
          ) : null}

          {state.data && state.data.orders.length > 0 ? (
            <ul className="space-y-2">
              {state.data.orders.map((order) => (
                <li key={order.id}>
                  <Link
                    to={`/merchant/${businessId}/orders/${order.id}`}
                    className="card block p-4 hover:shadow-lift"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-base font-semibold text-ink">{order.orderCode}</p>
                        <p className="text-sm text-ink-muted">
                          {order.customerName} · {dateTime(order.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(order.status)}>{order.statusLabel}</Badge>
                        <span className="text-sm font-semibold text-ink">{money(order.total)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </MerchantGate>
  );
}
