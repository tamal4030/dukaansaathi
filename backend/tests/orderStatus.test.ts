import { describe, expect, it } from 'vitest';
import { allowedTransitions, canTransition, statusLabel } from '../src/lib/orderStatus';

describe('order status transitions', () => {
  it('allows the normal pickup flow', () => {
    expect(canTransition('NEW', 'ACCEPTED', 'PICKUP').ok).toBe(true);
    expect(canTransition('ACCEPTED', 'PREPARING', 'PICKUP').ok).toBe(true);
    expect(canTransition('PREPARING', 'READY_FOR_PICKUP', 'PICKUP').ok).toBe(true);
    expect(canTransition('READY_FOR_PICKUP', 'COMPLETED', 'PICKUP').ok).toBe(true);
  });

  it('allows the normal delivery flow', () => {
    expect(canTransition('PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERY').ok).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'COMPLETED', 'DELIVERY').ok).toBe(true);
  });

  it('blocks pickup orders from going out for delivery and vice versa', () => {
    const pickup = canTransition('PREPARING', 'OUT_FOR_DELIVERY', 'PICKUP');
    expect(pickup.ok).toBe(false);
    expect(pickup.ok === false && pickup.error).toContain('pickup order');

    const delivery = canTransition('PREPARING', 'READY_FOR_PICKUP', 'DELIVERY');
    expect(delivery.ok).toBe(false);
    expect(delivery.ok === false && delivery.error).toContain('delivery order');
  });

  it('never moves a completed or cancelled order', () => {
    expect(allowedTransitions('COMPLETED', 'DELIVERY')).toEqual([]);
    expect(allowedTransitions('CANCELLED', 'DELIVERY')).toEqual([]);
    expect(canTransition('COMPLETED', 'PREPARING', 'PICKUP').ok).toBe(false);
  });

  it('rejects skipping steps such as NEW to COMPLETED', () => {
    expect(canTransition('NEW', 'COMPLETED', 'PICKUP').ok).toBe(false);
    expect(canTransition('NEW', 'PREPARING', 'PICKUP').ok).toBe(false);
  });

  it('rejects setting the same status again', () => {
    const result = canTransition('NEW', 'NEW', 'PICKUP');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('already');
  });

  it('has a customer-facing label for every status', () => {
    expect(statusLabel('READY_FOR_PICKUP')).toBe('Ready for pickup');
    expect(statusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
  });
});
