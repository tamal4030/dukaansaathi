import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../providers/AuthProvider';
import { AppShell } from '../../components/AppShell';
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { statusTone } from '../../lib/format';

export function OrdersPage() {
  const { t, money, date } = useI18n();
  const { signedIn, configured } = useAuth();

  const state = useAsync(() => (signedIn ? api.orders.list() : Promise.resolve({ orders: [] })), [signedIn]);

  const nav = useMemo(
    () => [
      { to: '/explore', label: t('nav.explore') },
      { to: '/orders', label: t('nav.orders'), end: true },
      { to: '/account', label: t('nav.account') },
    ],
    [t],
  );

  if (!signedIn) {
    return (
      <AppShell nav={nav} title={t('orders.title')}>
        <EmptyState
          body={configured ? t('auth.customerSignInIntro') : t('auth.notConfigured')}
          action={
            <Link to="/auth/customer" className="btn-primary">
              {t('auth.continueWithGoogle')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell nav={nav} title={t('orders.title')}>
      {state.loading ? <LoadingState /> : null}
      {state.error ? <ErrorState message={state.error.message} onRetry={state.reload} /> : null}

      {!state.loading && !state.error && (state.data?.orders.length ?? 0) === 0 ? (
        <EmptyState
          body={t('account.noOrders')}
          action={
            <Link to="/explore" className="btn-primary">
              {t('explore.title')}
            </Link>
          }
        />
      ) : null}

      {state.data && state.data.orders.length > 0 ? (
        <ul className="space-y-3">
          {state.data.orders.map((order) => (
            <li key={order.id}>
              <Link to={`/orders/${order.id}`} className="card block p-4 hover:shadow-lift">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-ink">
                      {t('orders.orderCode', { code: order.orderCode })}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {order.business?.name} · {t('orders.placedOn', { date: date(order.createdAt) })}
                    </p>
                  </div>
                  <Badge tone={statusTone(order.status)}>{order.statusLabel}</Badge>
                </div>
                <p className="mt-2 text-sm text-ink">
                  {t('cart.itemCount', { count: order.items.length })} · {money(order.total)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </AppShell>
  );
}
