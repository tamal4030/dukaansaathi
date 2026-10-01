import { FulfillmentType, OrderStatus } from '@prisma/client';

export const ORDER_STATUSES: OrderStatus[] = [
  'NEW',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
];

export const TERMINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED'];

const BASE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  READY_FOR_PICKUP: ['COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Fulfilment-specific rules: a pickup order cannot go "out for delivery". */
export function allowedTransitions(status: OrderStatus, fulfillment: FulfillmentType): OrderStatus[] {
  const base = BASE_TRANSITIONS[status] ?? [];
  return base.filter((next) => {
    if (next === 'READY_FOR_PICKUP') return fulfillment === 'PICKUP';
    if (next === 'OUT_FOR_DELIVERY') return fulfillment === 'DELIVERY';
    return true;
  });
}

export type TransitionCheck = { ok: true } | { ok: false; error: string };

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: FulfillmentType,
): TransitionCheck {
  if (from === to) return { ok: false, error: `Order is already ${statusLabel(to)}.` };
  const allowed = allowedTransitions(from, fulfillment);
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Cannot move an order from ${statusLabel(from)} to ${statusLabel(to)}${
        fulfillment === 'PICKUP' && to === 'OUT_FOR_DELIVERY'
          ? ' because this is a pickup order'
          : fulfillment === 'DELIVERY' && to === 'READY_FOR_PICKUP'
            ? ' because this is a delivery order'
            : ''
      }.`,
    };
  }
  return { ok: true };
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'NEW':
      return 'New';
    case 'ACCEPTED':
      return 'Accepted';
    case 'PREPARING':
      return 'Preparing';
    case 'READY_FOR_PICKUP':
      return 'Ready for pickup';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}
