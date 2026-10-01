import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { openStateTone, addressLine } from '../lib/format';
import { Badge } from './ui';
import type { PublicBusiness } from '../lib/types';

export function BusinessCard({ business, onOpen }: { business: PublicBusiness; onOpen?: () => void }) {
  const { t } = useI18n();

  const openLabel =
    business.openState === 'open'
      ? t('explore.openNow')
      : business.openState === 'closed'
        ? t('explore.closedNow')
        : t('explore.hoursUnknown');

  const location = addressLine(business.address);

  return (
    <Link
      to={`/business/${business.slug}`}
      onClick={onOpen}
      className="card block p-4 transition hover:shadow-lift focus:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">{business.name}</h3>
        <Badge tone={openStateTone(business.openState)}>{openLabel}</Badge>
      </div>

      <p className="mt-1 text-sm text-ink-muted">{business.categoryLabel}</p>
      {location ? <p className="mt-0.5 text-sm text-ink-muted">{location}</p> : null}
      {business.description ? (
        <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{business.description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {business.deliveryEnabled ? <Badge tone="bg-brand-50 text-brand-700">{t('business.delivery')}</Badge> : null}
        {business.pickupEnabled ? <Badge tone="bg-slate-100 text-slate-700">{t('business.pickup')}</Badge> : null}
        {typeof business.productCount === 'number' ? (
          <Badge tone="bg-slate-100 text-slate-700">{t('explore.products', { count: business.productCount })}</Badge>
        ) : null}
      </div>
    </Link>
  );
}
