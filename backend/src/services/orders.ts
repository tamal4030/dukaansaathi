import { Prisma, type FulfillmentType, type OrderStatus, type Product } from '@prisma/client';
import type { Db } from '../db/prisma';
import { availabilityLabel, isOrderable } from '../lib/availability';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { money } from '../lib/money';
import { canTransition, statusLabel } from '../lib/orderStatus';
import { logger } from '../lib/logger';

export const MAX_ORDER_LINES = 50;
export const MAX_QUANTITY_PER_LINE = 200;

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface QuoteLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  availability: string;
  availabilityLabel: string;
  orderable: boolean;
  issue?: string;
}

export interface QuoteResult {
  business: {
    id: string;
    name: string;
    slug: string;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
  };
  lines: QuoteLine[];
  subtotal: string;
  total: string;
  currency: string;
  issues: string[];
  canSubmit: boolean;
}

export interface QuoteDeps {
  prisma: Db;
}

export function normalizeItems(raw: unknown): OrderItemInput[] {
  if (!Array.isArray(raw)) throw badRequest('Add at least one product to the cart.');
  if (raw.length === 0) throw badRequest('Your cart is empty.');
  if (raw.length > MAX_ORDER_LINES) {
    throw badRequest(`A single order can contain at most ${MAX_ORDER_LINES} different products.`);
  }
  const merged = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') throw badRequest('Each cart line needs a product and a quantity.');
    const record = entry as Record<string, unknown>;
    const productId = typeof record.productId === 'string' ? record.productId.trim() : '';
    if (!productId) throw badRequest('Each cart line needs a product.');
    const quantityNumber = Number(record.quantity);
    if (!Number.isInteger(quantityNumber) || quantityNumber < 1 || quantityNumber > MAX_QUANTITY_PER_LINE) {
      throw badRequest(`Quantity must be a whole number between 1 and ${MAX_QUANTITY_PER_LINE}.`);
    }
    merged.set(productId, Math.min(MAX_QUANTITY_PER_LINE, (merged.get(productId) ?? 0) + quantityNumber));
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Prices, availability and totals always come from the database - never from
 * the browser or the model.
 */
export async function quoteOrder(
  { prisma }: QuoteDeps,
  businessId: string,
  rawItems: unknown,
): Promise<QuoteResult> {
  const items = normalizeItems(rawItems);

  const business = await prisma.business.findFirst({
    where: { id: businessId, isActive: true, isPublic: true },
  });
  if (!business) throw notFound('This business is not available right now.');

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) }, businessId, isArchived: false },
  });
  const byId = new Map<string, Product>(products.map((product) => [product.id, product]));

  const lines: QuoteLine[] = [];
  const issues: string[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      issues.push('One of the products is no longer sold by this business and was removed from the cart.');
      continue;
    }
    const unitPrice = new Prisma.Decimal(product.price);
    const lineTotal = unitPrice.mul(item.quantity);
    const orderable = isOrderable(product.availability);
    let issue: string | undefined;
    if (product.availability === 'OUT_OF_STOCK') {
      issue = `${product.name} is out of stock at this shop.`;
    } else if (product.availability === 'UNKNOWN') {
      issue = `${product.name} has unknown availability, so the shop cannot confirm it yet. Please contact the business.`;
    }
    if (issue) issues.push(issue);

    lines.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: money(unitPrice),
      lineTotal: money(lineTotal),
      availability: product.availability,
      availabilityLabel: availabilityLabel(product.availability),
      orderable,
      ...(issue ? { issue } : {}),
    });
  }

  const subtotal = lines
    .filter((line) => line.orderable)
    .reduce((acc, line) => acc.plus(new Prisma.Decimal(line.lineTotal)), new Prisma.Decimal(0));

  return {
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      pickupEnabled: business.pickupEnabled,
      deliveryEnabled: business.deliveryEnabled,
    },
    lines,
    subtotal: money(subtotal),
    total: money(subtotal),
    currency: 'INR',
    issues,
    canSubmit: lines.length > 0 && lines.every((line) => line.orderable),
  };
}

export interface CreateOrderInput {
  businessId: string;
  customer: { id: string; email: string | null; fullName: string | null };
  items: unknown;
  fulfillment: FulfillmentType;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  confirmed: boolean;
}

export function generateOrderCode(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `DS-${stamp}-${random}`;
}

export async function createOrder(prisma: Db, input: CreateOrderInput) {
  if (!input.confirmed) {
    throw badRequest('Please review the cart and confirm the order before it is sent to the business.');
  }

  const customerName = (input.customerName ?? input.customer.fullName ?? '').trim();
  if (customerName.length < 2) throw badRequest('Please add the name the shop should use.');
  const customerEmail = (input.customerEmail ?? input.customer.email ?? '').trim() || null;
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw badRequest('That email address does not look right.');
  }
  const customerPhone = (input.customerPhone ?? '').trim();
  if (!/^[0-9+\-\s()]{6,20}$/.test(customerPhone)) {
    throw badRequest('Please add a contact phone number so the shop can reach you.');
  }
  if (input.fulfillment !== 'PICKUP' && input.fulfillment !== 'DELIVERY') {
    throw badRequest('Choose pickup or delivery.');
  }

  const quote = await quoteOrder({ prisma }, input.businessId, input.items);
  if (quote.lines.length === 0) throw badRequest('Your cart is empty.');
  if (!quote.canSubmit) {
    throw conflict(
      quote.issues[0] ??
        'Some items in the cart cannot be ordered right now. Please review the cart and try again.',
    );
  }
  if (input.fulfillment === 'DELIVERY' && !quote.business.deliveryEnabled) {
    throw conflict('This business does not offer delivery. Please choose pickup.');
  }
  if (input.fulfillment === 'PICKUP' && !quote.business.pickupEnabled) {
    throw conflict('This business does not offer pickup. Please choose delivery.');
  }

  const deliveryAddress = (input.deliveryAddress ?? '').trim();
  if (input.fulfillment === 'DELIVERY' && deliveryAddress.length < 10) {
    throw badRequest('Please add the full delivery address (at least 10 characters).');
  }
  const notes = (input.notes ?? '').trim().slice(0, 500) || null;

  const items = normalizeItems(input.items);
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) }, businessId: input.businessId, isArchived: false },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const created = await prisma.$transaction(async (tx) => {
    const lines = items.map((item) => {
      const product = byId.get(item.productId);
      if (!product || !isOrderable(product.availability)) {
        throw conflict('An item in your cart is no longer available. Please refresh the cart.');
      }
      const unitPrice = new Prisma.Decimal(product.price);
      return {
        productId: product.id,
        nameSnapshot: product.name,
        unitPriceSnapshot: unitPrice,
        quantity: item.quantity,
        lineTotal: unitPrice.mul(item.quantity),
      };
    });

    const subtotal = lines.reduce((acc, line) => acc.plus(line.lineTotal), new Prisma.Decimal(0));

    const order = await tx.order.create({
      data: {
        orderCode: generateOrderCode(),
        businessId: input.businessId,
        customerId: input.customer.id,
        fulfillment: input.fulfillment,
        status: 'NEW',
        customerName,
        customerEmail,
        customerPhone,
        deliveryAddress: input.fulfillment === 'DELIVERY' ? deliveryAddress : null,
        notes,
        subtotal,
        total: subtotal,
        currency: 'INR',
        items: { create: lines },
        statusEvents: {
          create: { status: 'NEW', note: 'Order placed by the customer through DukaanSaathi.' },
        },
      },
      include: { items: true, statusEvents: true },
    });
    return order;
  }, {
    // Interactive transactions default to a 5s timeout. Creating an order
    // writes the order, its items and the first status event, and a managed
    // database adds real network latency to each step, so the default is too
    // tight and fails with P2028. The budget below is generous but still
    // bounded, so a genuinely stuck transaction is aborted.
    timeout: 20000,
    maxWait: 10000,
  });

  logger.info('order created', { orderId: created.id, orderCode: created.orderCode, businessId: created.businessId });
  return created;
}

export interface StatusUpdateInput {
  orderId: string;
  businessId: string;
  nextStatus: OrderStatus;
  note?: string | null;
  actorUserId: string;
}

export async function updateOrderStatus(prisma: Db, input: StatusUpdateInput) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    include: { items: true },
  });
  if (!order) throw notFound('Order not found.');
  if (order.businessId !== input.businessId) throw forbidden('This order belongs to another business.');

  const check = canTransition(order.status, input.nextStatus, order.fulfillment);
  if (!check.ok) throw conflict(check.error);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: input.nextStatus,
        note: (input.note ?? '').trim().slice(0, 500) || null,
        changedByUserId: input.actorUserId,
      },
    });
    return tx.order.update({
      where: { id: order.id },
      data: { status: input.nextStatus },
      include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
    });
  }, {
    // Interactive transactions default to a 5s timeout. Creating an order
    // writes the order, its items and the first status event, and a managed
    // database adds real network latency to each step, so the default is too
    // tight and fails with P2028. The budget below is generous but still
    // bounded, so a genuinely stuck transaction is aborted.
    timeout: 20000,
    maxWait: 10000,
  });

  return { order: updated, previousStatus: order.status, statusLabel: statusLabel(updated.status) };
}
