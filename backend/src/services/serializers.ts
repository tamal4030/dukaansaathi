import type {
  Business,
  BusinessFaq,
  BusinessHour,
  Conversation,
  Message,
  Order,
  OrderItem,
  OrderReview,
  OrderStatusEvent,
  Product,
  UserProfile,
} from '@prisma/client';
import { availabilityLabel } from '../lib/availability';
import { categoryLabel } from '../lib/categories';
import { money } from '../lib/money';
import { statusLabel } from '../lib/orderStatus';
import { toPublicHours, type OpenState } from '../lib/hours';

export function productToPublic(product: Product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    price: money(product.price),
    currency: product.currency,
    availability: product.availability,
    availabilityLabel: availabilityLabel(product.availability),
    aliases: product.aliases,
    updatedAt: product.updatedAt,
  };
}

export function productToMerchant(product: Product) {
  return { ...productToPublic(product), isArchived: product.isArchived, createdAt: product.createdAt };
}

export function businessToPublic(
  business: Business & { hours?: BusinessHour[]; faqs?: BusinessFaq[]; _count?: { products: number } },
  openState: OpenState,
) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    category: business.category,
    categoryLabel: categoryLabel(business.category),
    description: business.description,
    publicPhone: business.publicPhone,
    publicEmail: business.publicEmail,
    address: {
      line: business.addressLine,
      city: business.city,
      state: business.state,
      pincode: business.pincode,
      latitude: business.latitude,
      longitude: business.longitude,
    },
    openState,
    hours: toPublicHours(business.hours ?? []),
    pickupEnabled: business.pickupEnabled,
    deliveryEnabled: business.deliveryEnabled,
    deliveryNotes: business.deliveryNotes,
    paymentMethods: business.paymentMethods,
    returnPolicy: business.returnPolicy,
    faqs: (business.faqs ?? [])
      .filter((faq) => faq.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer })),
    productCount: business._count?.products ?? undefined,
  };
}

export function businessToMerchant(
  business: Business & { hours?: BusinessHour[]; faqs?: BusinessFaq[]; _count?: { products: number } },
  openState: OpenState,
) {
  return {
    ...businessToPublic(business, openState),
    ownerId: business.ownerId,
    isActive: business.isActive,
    isPublic: business.isPublic,
    assistantNotes: business.assistantNotes,
    emailNotificationsOptIn: business.emailNotificationsOptIn,
    emailNotificationsEmail: business.emailNotificationsEmail,
    createdAt: business.createdAt,
    faqs: (business.faqs ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((faq) => ({ id: faq.id, question: faq.question, answer: faq.answer, sortOrder: faq.sortOrder, isActive: faq.isActive })),
  };
}

export function orderToCustomer(order: Order & { items: OrderItem[]; statusEvents?: OrderStatusEvent[]; review?: OrderReview | null }) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    statusLabel: statusLabel(order.status),
    fulfillment: order.fulfillment,
    businessId: order.businessId,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    notes: order.notes,
    subtotal: money(order.subtotal),
    total: money(order.total),
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: money(item.unitPriceSnapshot),
      lineTotal: money(item.lineTotal),
    })),
    statusHistory: (order.statusEvents ?? []).map((event) => ({
      id: event.id,
      status: event.status,
      statusLabel: statusLabel(event.status),
      note: event.note,
      createdAt: event.createdAt,
    })),
    canReview: order.status === 'COMPLETED' && !order.review,
    review: order.review
      ? { id: order.review.id, rating: order.review.rating, comment: order.review.comment, tags: order.review.tags, createdAt: order.review.createdAt }
      : null,
  };
}

export function orderToMerchant(order: Order & { items: OrderItem[]; statusEvents?: OrderStatusEvent[]; review?: OrderReview | null }) {
  return {
    ...orderToCustomer(order),
    customerEmail: order.customerEmail,
    review: order.review
      ? { id: order.review.id, rating: order.review.rating, comment: order.review.comment, tags: order.review.tags, createdAt: order.review.createdAt, source: 'ORDER' as const }
      : null,
  };
}

export function reviewToMerchant(review: OrderReview) {
  return {
    id: review.id,
    orderId: review.orderId,
    rating: review.rating,
    comment: review.comment,
    tags: review.tags,
    createdAt: review.createdAt,
    source: 'ORDER' as const,
  };
}

/** Public review view: no email, no phone, no order id. */
export function reviewToPublic(review: OrderReview) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    tags: review.tags,
    createdAt: review.createdAt,
  };
}

export function conversationToMerchant(
  conversation: Conversation & {
    messages?: Message[];
    user?: Pick<UserProfile, 'fullName' | 'email'> | null;
  },
) {
  return {
    id: conversation.id,
    businessId: conversation.businessId,
    status: conversation.status,
    customerLocale: conversation.customerLocale,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    isGuest: !conversation.userId,
    customerName: conversation.user?.fullName ?? (conversation.userId ? null : 'Guest customer'),
    messages: conversation.messages?.map(messageToPublic),
  };
}

export function messageToPublic(message: Message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    language: message.language,
    source: message.source,
    createdAt: message.createdAt,
  };
}

export function profileToPublic(profile: UserProfile) {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    locale: profile.locale,
    role: profile.role,
    signInProvider: profile.signInProvider,
    emailNotificationsOptIn: profile.emailNotificationsOptIn,
    createdAt: profile.createdAt,
  };
}
