import type { Business, Order, OrderItem, OrderReview, UserProfile } from '@prisma/client';
import type { Db } from '../db/prisma';
import { escapeHtml, type EmailSender } from './email';
import { statusLabel } from '../lib/orderStatus';
import { money } from '../lib/money';
import { logger } from '../lib/logger';

export interface NotificationDeps {
  prisma: Db;
  email: EmailSender;
  frontendUrl: string;
}

export type NotificationOutcome = 'SENT' | 'FAILED' | 'SKIPPED';

type OrderWithItems = Order & { items: OrderItem[] };

function itemsHtml(items: Array<{ name: string; quantity: number; lineTotal: string }>): string {
  return items
    .map(
      (item) =>
        `<li>${escapeHtml(item.name)} &times; ${item.quantity} - &#8377;${escapeHtml(item.lineTotal)}</li>`,
    )
    .join('');
}

function itemsText(items: Array<{ name: string; quantity: number; lineTotal: string }>): string {
  return items.map((item) => `- ${item.name} x ${item.quantity} = Rs ${item.lineTotal}`).join('\n');
}

const ORDER_ITEM_SNAPSHOT = (order: OrderWithItems) =>
  order.items.map((item) => ({
    name: item.nameSnapshot,
    quantity: item.quantity,
    lineTotal: money(item.lineTotal),
  }));

/**
 * Emails are supplementary: every failure is logged and reported honestly, and
 * the order stays saved and usable.
 */
export async function notifyBusinessNewOrder(
  deps: NotificationDeps,
  order: OrderWithItems,
  business: Business,
): Promise<NotificationOutcome> {
  const recipient = business.emailNotificationsEmail || null;
  if (!business.emailNotificationsOptIn || !recipient) {
    await safeLog(deps, order.id, 'ORDER_CREATED_BUSINESS', recipient ?? 'not-set', 'SKIPPED', 'The business has not opted in to order emails.');
    return 'SKIPPED';
  }

  const items = ORDER_ITEM_SNAPSHOT(order);
  const dashboardUrl = `${deps.frontendUrl}/merchant/orders/${order.id}`;
  const result = await deps.email.send({
    to: recipient,
    replyTo: order.customerEmail ?? undefined,
    subject: `New order ${order.orderCode} from ${order.customerName}`,
    text: [
      `New order ${order.orderCode}`,
      `Customer: ${order.customerName} (${order.customerPhone ?? 'no phone'})`,
      `Fulfilment: ${order.fulfillment === 'PICKUP' ? 'Pickup' : 'Delivery'}`,
      order.deliveryAddress ? `Address: ${order.deliveryAddress}` : '',
      '',
      itemsText(items),
      '',
      `Total: Rs ${money(order.total)}`,
      order.notes ? `Notes: ${order.notes}` : '',
      '',
      `Open the order: ${dashboardUrl}`,
    ]
      .filter(Boolean)
      .join('\n'),
    html: `<h2>New order ${escapeHtml(order.orderCode)}</h2>
<p><strong>Customer:</strong> ${escapeHtml(order.customerName)} ${escapeHtml(order.customerPhone ?? '')}</p>
<p><strong>Fulfilment:</strong> ${order.fulfillment === 'PICKUP' ? 'Pickup' : 'Delivery'}</p>
${order.deliveryAddress ? `<p><strong>Address:</strong> ${escapeHtml(order.deliveryAddress)}</p>` : ''}
<ul>${itemsHtml(items)}</ul>
<p><strong>Total:</strong> &#8377;${escapeHtml(money(order.total))}</p>
${order.notes ? `<p><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ''}
<p><a href="${escapeHtml(dashboardUrl)}">Open the order in your dashboard</a></p>`,
  });

  await safeLog(deps, order.id, 'ORDER_CREATED_BUSINESS', recipient, result.status, result.error);
  return result.status;
}

export async function notifyCustomerOrderStatus(
  deps: NotificationDeps,
  order: OrderWithItems,
  business: Business,
  customer: Pick<UserProfile, 'email' | 'emailNotificationsOptIn'> | null,
): Promise<NotificationOutcome> {
  const recipient = order.customerEmail || customer?.email || null;
  if (!customer?.emailNotificationsOptIn || !recipient) {
    await safeLog(deps, order.id, 'ORDER_STATUS_CUSTOMER', recipient ?? 'not-set', 'SKIPPED', 'The customer has not opted in to order emails.');
    return 'SKIPPED';
  }

  const items = ORDER_ITEM_SNAPSHOT(order);
  const orderUrl = `${deps.frontendUrl}/account/orders/${order.id}`;
  const result = await deps.email.send({
    to: recipient,
    replyTo: business.publicEmail ?? undefined,
    subject: `Order ${order.orderCode} is now ${statusLabel(order.status)}`,
    text: [
      `${business.name} updated your order ${order.orderCode}.`,
      `New status: ${statusLabel(order.status)}`,
      '',
      itemsText(items),
      '',
      `Total: Rs ${money(order.total)}`,
      '',
      `See the order: ${orderUrl}`,
    ].join('\n'),
    html: `<h2>${escapeHtml(business.name)}</h2>
<p>Your order <strong>${escapeHtml(order.orderCode)}</strong> is now <strong>${escapeHtml(statusLabel(order.status))}</strong>.</p>
<ul>${itemsHtml(items)}</ul>
<p><strong>Total:</strong> &#8377;${escapeHtml(money(order.total))}</p>
<p><a href="${escapeHtml(orderUrl)}">See the order</a></p>`,
  });

  await safeLog(deps, order.id, 'ORDER_STATUS_CUSTOMER', recipient, result.status, result.error);
  return result.status;
}

export async function notifyBusinessNewReview(
  deps: NotificationDeps,
  review: OrderReview,
  business: Business,
): Promise<NotificationOutcome> {
  const recipient = business.emailNotificationsEmail || null;
  if (!business.emailNotificationsOptIn || !recipient) {
    await safeLog(deps, review.orderId, 'ORDER_STATUS_CUSTOMER', recipient ?? 'not-set', 'SKIPPED', 'The business has not opted in to emails.');
    return 'SKIPPED';
  }
  const reviewUrl = `${deps.frontendUrl}/merchant/reviews`;
  const result = await deps.email.send({
    to: recipient,
    subject: `New ${review.rating}-star review for ${business.name}`,
    text: `A customer rated an order ${review.rating}/5.\n\n${review.comment ?? ''}\n\n${reviewUrl}`,
    html: `<h2>New ${review.rating}-star review</h2>${review.comment ? `<p>${escapeHtml(review.comment)}</p>` : ''}<p><a href="${escapeHtml(reviewUrl)}">See your reviews</a></p>`,
  });
  await safeLog(deps, review.orderId, 'ORDER_STATUS_CUSTOMER', recipient, result.status, result.error);
  return result.status;
}

async function safeLog(
  deps: NotificationDeps,
  orderId: string | null,
  type: 'ORDER_CREATED_BUSINESS' | 'ORDER_STATUS_CUSTOMER',
  recipient: string,
  status: NotificationOutcome,
  error?: string,
): Promise<void> {
  try {
    await deps.prisma.notificationLog.create({
      data: {
        orderId: orderId ?? undefined,
        type,
        recipient: recipient.slice(0, 200),
        status,
        error: error ? error.slice(0, 500) : null,
      },
    });
  } catch (logError) {
    logger.warn('could not write notification log', { reason: (logError as Error).message });
  }
}
