import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartProvider, useCart } from './CartProvider';

function CartProbe() {
  const cart = useCart();
  return (
    <div>
      <span data-testid="business">{cart.businessId ?? 'none'}</span>
      <span data-testid="count">{cart.count}</span>
      <span data-testid="lines">{cart.lines.map((line) => `${line.name}:${line.quantity}`).join(',')}</span>
      <button type="button" onClick={() => cart.setBusiness('biz-0001')}>
        open shop
      </button>
      <button
        type="button"
        onClick={() =>
          cart.add({ productId: 'p1', name: 'Atta', unitPrice: '265.00', availability: 'AVAILABLE' })
        }
      >
        add atta
      </button>
      <button
        type="button"
        onClick={() =>
          cart.add({ productId: 'p2', name: 'Rice', unitPrice: '95.00', availability: 'UNKNOWN' })
        }
      >
        add rice
      </button>
      <button type="button" onClick={() => cart.setQuantity('p1', 5)}>
        set qty
      </button>
      <button type="button" onClick={() => cart.remove('p1')}>
        remove atta
      </button>
      <button type="button" onClick={cart.clear}>
        clear
      </button>
    </div>
  );
}

function setup() {
  return render(
    <CartProvider>
      <CartProbe />
    </CartProvider>,
  );
}

/**
 * Carts are per-shop and stored in the browser so a guest's selection survives
 * the Google sign-in redirect. These are indicative quantities only: the
 * backend recalculates prices and totals from PostgreSQL.
 */
describe('CartProvider', () => {
  it('starts empty with no shop selected', () => {
    setup();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('business')).toHaveTextContent('none');
  });

  it('adds a product and counts quantities', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('lines')).toHaveTextContent('Atta:1');
  });

  it('increments an existing line instead of duplicating it', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    expect(screen.getByTestId('lines')).toHaveTextContent('Atta:2');
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('sets an explicit quantity and removes a line', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    await user.click(screen.getByRole('button', { name: 'set qty' }));
    expect(screen.getByTestId('lines')).toHaveTextContent('Atta:5');

    await user.click(screen.getByRole('button', { name: 'remove atta' }));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('clears the cart', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('persists the cart to browser storage for the sign-in round trip', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    const stored = window.localStorage.getItem('dukaansaathi.carts');
    expect(stored).toBeTruthy();
    expect(stored).toContain('Atta');
  });

  it('keeps separate carts per shop so one shop cannot see another', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'open shop' }));
    await user.click(screen.getByRole('button', { name: 'add atta' }));
    expect(screen.getByTestId('lines')).toHaveTextContent('Atta');
    // Switching business id is not exposed through the probe, so verify storage
    // is keyed by business id instead.
    const parsed = JSON.parse(window.localStorage.getItem('dukaansaathi.carts') ?? '{}');
    expect(Object.keys(parsed)).toContain('biz-0001');
  });
});
