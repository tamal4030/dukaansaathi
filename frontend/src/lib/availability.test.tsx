import { describe, expect, it } from 'vitest';
import { availabilityText } from '../components/ProductCard';
import { renderWithProviders } from '../test/renderWithProviders';
import { ProductCard } from '../components/ProductCard';
import type { Availability, PublicProduct } from './types';

/**
 * The single most important product rule: "Unknown" availability must never be
 * presented as available, and must not be orderable.
 */
describe('availability presentation', () => {
  const t = ((key: string) => {
    const table: Record<string, string> = {
      'product.available': 'Available',
      'product.outOfStock': 'Out of stock',
      'product.unknownAvailability': 'Availability unknown',
    };
    return table[key] ?? key;
  }) as never;

  it('maps each stored state to a distinct label', () => {
    expect(availabilityText('AVAILABLE', t)).toBe('Available');
    expect(availabilityText('OUT_OF_STOCK', t)).toBe('Out of stock');
    expect(availabilityText('UNKNOWN', t)).toBe('Availability unknown');
  });

  it('never renders Unknown as Available', () => {
    const values: Availability[] = ['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN'];
    const labels = values.map((value) => availabilityText(value, t));
    expect(labels[2]).not.toBe(labels[0]);
    expect(labels[2].toLowerCase()).not.toContain('available</');
    expect(labels[2]).toBe('Availability unknown');
  });
});

describe('ProductCard', () => {
  function product(availability: Availability): PublicProduct {
    return {
      id: 'p1',
      name: 'Aashirvaad Atta 5kg',
      description: 'Whole wheat flour',
      category: 'Atta & rice',
      price: '265.00',
      currency: 'INR',
      availability,
      availabilityLabel: availability,
      aliases: [],
    };
  }

  it('offers an add button for an available product', () => {
    const onAdd = () => undefined;
    const { getByRole } = renderWithProviders(<ProductCard product={product('AVAILABLE')} onAdd={onAdd} />);
    const button = getByRole('button', { name: /add/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('disables ordering for out-of-stock and unknown products', () => {
    for (const availability of ['OUT_OF_STOCK', 'UNKNOWN'] as Availability[]) {
      const { getByRole, unmount } = renderWithProviders(
        <ProductCard product={product(availability)} onAdd={() => undefined} />,
      );
      expect(getByRole('button', { name: /add/i })).toBeDisabled();
      unmount();
    }
  });

  it('shows the price formatted in rupees', () => {
    const { getByText } = renderWithProviders(<ProductCard product={product('AVAILABLE')} />);
    expect(getByText(/265\.00/)).toBeInTheDocument();
  });
});
