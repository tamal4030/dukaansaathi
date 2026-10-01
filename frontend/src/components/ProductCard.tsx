import { useI18n } from '../lib/i18n';
import { availabilityTone } from '../lib/format';
import { Badge } from './ui';
import type { Availability, PublicProduct } from '../lib/types';

export function availabilityText(
  availability: Availability,
  t: (key: 'product.available' | 'product.outOfStock' | 'product.unknownAvailability') => string,
): string {
  switch (availability) {
    case 'AVAILABLE':
      return t('product.available');
    case 'OUT_OF_STOCK':
      return t('product.outOfStock');
    default:
      // Unknown is never presented as available.
      return t('product.unknownAvailability');
  }
}

export function ProductCard({
  product,
  onAdd,
  added,
}: {
  product: PublicProduct;
  onAdd?: (product: PublicProduct) => void;
  added?: boolean;
}) {
  const { t, money } = useI18n();
  const orderable = product.availability === 'AVAILABLE';

  return (
    <article className="card flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">{product.name}</h3>
        <Badge tone={availabilityTone(product.availability)}>{availabilityText(product.availability, t)}</Badge>
      </div>

      {product.category ? <p className="mt-1 text-xs text-ink-soft">{product.category}</p> : null}
      {product.description ? <p className="mt-2 flex-1 text-sm text-ink-muted">{product.description}</p> : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-ink">{money(product.price)}</p>
        {onAdd ? (
          <button
            type="button"
            className="btn-primary px-3 py-2"
            disabled={!orderable}
            title={orderable ? undefined : t('chat.notOrderable')}
            onClick={() => onAdd(product)}
          >
            {added ? t('product.added') : t('product.addToCart')}
          </button>
        ) : null}
      </div>
      {!orderable ? <p className="mt-2 text-xs text-amber-800">{t('chat.notOrderable')}</p> : null}
    </article>
  );
}
