import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAsync } from '../hooks/useAsync';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../providers/AuthProvider';
import { AppShell } from './AppShell';
import { EmptyState, ErrorState, LoadingState } from './ui';
import type { ReactNode } from 'react';
import type { MerchantBusiness } from '../lib/types';

export interface MerchantContext {
  business: MerchantBusiness;
  reload: () => void;
}

/**
 * Guards every merchant screen: the signed-in owner must have a business, and
 * the backend independently re-checks ownership on each request.
 *
 * Navigation links are built from the RESOLVED business id, never from the raw
 * route parameter. Otherwise opening /merchant (where there is no :businessId)
 * would produce links like /merchant/orders, which the router matches against
 * /merchant/:businessId and interprets "orders" as a business id.
 */
export function MerchantGate({
  children,
  title,
  subtitle,
  actions,
}: {
  children: (context: MerchantContext) => ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const { signedIn, configured, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const businessId = params.businessId;

  // When the route already names a business, load it directly. Listing every
  // business first would be a wasted round trip (and a waterfall) on every
  // merchant screen.
  const list = useAsync(
    () =>
      !businessId && signedIn
        ? api.merchant.listBusinesses()
        : Promise.resolve({ businesses: [] as MerchantBusiness[] }),
    [signedIn, businessId],
  );

  const detail = useAsync(
    () =>
      businessId && signedIn
        ? api.merchant.getBusiness(businessId)
        : Promise.resolve({ business: null as MerchantBusiness | null, role: '' }),
    [businessId, signedIn],
  );

  useEffect(() => {
    if (!authLoading && !signedIn) navigate('/business/login', { replace: true });
  }, [authLoading, signedIn, navigate]);

  const resolved = detail.data?.business ?? (businessId ? null : (list.data?.businesses[0] ?? null));

  const nav = useMemo(() => {
    const base = resolved ? `/merchant/${resolved.id}` : null;
    const items = [{ to: '/merchant', label: t('nav.overview'), end: true }];
    if (base) {
      items.push(
        { to: `${base}/orders`, label: t('merchant.orders'), end: false },
        { to: `${base}/products`, label: t('merchant.products'), end: false },
        { to: `${base}/conversations`, label: t('merchant.conversations'), end: false },
        { to: `${base}/business`, label: t('nav.business'), end: false },
      );
    }
    return items;
  }, [resolved, t]);

  if (authLoading || list.loading || detail.loading) {
    return (
      <AppShell nav={nav}>
        <LoadingState />
      </AppShell>
    );
  }

  if (!configured) {
    return (
      <AppShell nav={nav}>
        <EmptyState body={t('auth.notConfigured')} />
      </AppShell>
    );
  }

  if (list.error || detail.error) {
    return (
      <AppShell nav={nav}>
        <ErrorState
          message={(list.error ?? detail.error)?.message}
          onRetry={() => {
            list.reload();
            detail.reload();
          }}
        />
      </AppShell>
    );
  }

  if (!resolved) {
    return (
      <AppShell nav={nav} title={t('merchant.noBusiness')}>
        <EmptyState
          body={t('merchant.setupIntro')}
          action={
            <Link to="/merchant/setup" className="btn-primary">
              {t('merchant.createBusinessCta')}
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      nav={nav}
      title={title ?? resolved.name}
      subtitle={subtitle ?? resolved.categoryLabel}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {/* Symmetric mode switch: a merchant can still shop as a customer. */}
          <Link to="/explore" className="btn-secondary">
            {t('nav.exploreAsCustomer')}
          </Link>
        </div>
      }
    >
      {children({
        business: resolved,
        reload: () => {
          list.reload();
          detail.reload();
        },
      })}
    </AppShell>
  );
}
