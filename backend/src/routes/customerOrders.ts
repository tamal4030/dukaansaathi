import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { publicLimiter } from '../middleware/rateLimit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parseBody } from '../lib/validate';
import { REVIEW_TAG_IDS } from '../lib/reviews';
import { createOrder, quoteOrder } from '../services/orders';
import { notifyBusinessNewOrder, notifyBusinessNewReview } from '../services/notifications';
import { orderToCustomer, reviewToPublic } from '../services/serializers';
import { logger } from '../lib/logger';
import type { AppDeps } from '../app';
import type { createAuthMiddleware } from '../middleware/auth';

type Auth = ReturnType<typeof createAuthMiddleware>;

const itemSchema = z.object({
  productId: z.string().trim().min(6).max(60),
  quantity: z.coerce.number().int().min(1).max(200),
});

const quoteSchema = z.object({
  businessId: z.string().trim().min(6).max(60),
  items: z.array(itemSchema).min(1, 'Add at least one product to the cart.').max(50),
});

const createSchema = quoteSchema.extend({
  fulfillment: z.enum(['PICKUP', 'DELIVERY']),
  customerName: z.string().trim().min(2).max(120).optional(),
  customerPhone: z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid contact phone number.'),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  /** The customer must explicitly confirm in the app before an order is created. */
  confirm: z.literal(true, { errorMap: () => ({ message: 'Please confirm the order before sending it to the business.' }) }),
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().max(40)).max(5).optional(),
});

export function customerOrderRouter(deps: AppDeps, auth: Auth): Router {
  const router = Router();
  const { prisma } = deps;

  /** Cart preview. Prices and totals always come from PostgreSQL. */
  router.post(
    '/quote',
    publicLimiter,
    asyncHandler(async (req, res) => {
      const body = parseBody(quoteSchema, req.body);
      const quote = await quoteOrder({ prisma }, body.businessId, body.items);
      res.json({ quote });
    }),
  );

  router.post(
    '/',
    publicLimiter,
    auth.requireAuth,
    auth.requireCustomerForOrder[1],
    asyncHandler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const profile = req.auth!.profile;

      const order = await createOrder(prisma, {
        businessId: body.businessId,
        customer: { id: profile.id, email: profile.email, fullName: profile.fullName },
        items: body.items,
        fulfillment: body.fulfillment,
        customerName: body.customerName ?? null,
        customerEmail: profile.email,
        customerPhone: body.customerPhone,
        deliveryAddress: body.deliveryAddress ?? null,
        notes: body.notes ?? null,
        confirmed: body.confirm === true,
      });

      const business = await prisma.business.findUnique({ where: { id: order.businessId } });
      if (!business) throw notFound('Business not found.');

      // Email is supplementary: a failure never rolls back or hides the order.
      let emailOutcome = 'SKIPPED';
      try {
        emailOutcome = await notifyBusinessNewOrder(
          { prisma, email: deps.email, frontendUrl: deps.frontendUrl },
          order,
          business,
        );
      } catch (error) {
        logger.warn('order notification threw, order kept', { reason: (error as Error).message });
      }

      res.status(201).json({
        order: orderToCustomer(order),
        business: { id: business.id, name: business.name, slug: business.slug },
        notifications: {
          businessEmail: emailOutcome,
          emailConfigured: Boolean(deps.email),
          note:
            emailOutcome === 'SKIPPED'
              ? 'The business has not enabled order emails, so no email was sent. The order is saved in the app.'
              : emailOutcome === 'FAILED'
                ? 'The order is saved, but the notification email could not be delivered.'
                : 'A notification email was sent to the business.',
        },
      });
    }),
  );

  router.get(
    '/',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const orders = await prisma.order.findMany({
        where: { customerId: req.auth!.profile.id },
        include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } }, review: true, business: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({
        orders: orders.map((order) => ({
          ...orderToCustomer(order),
          business: order.business,
        })),
      });
    }),
  );

  /** Fresh read of one order: the page refreshes status from the database. */
  router.get(
    '/:orderId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const order = await prisma.order.findFirst({
        where: { id: req.params.orderId, customerId: req.auth!.profile.id },
        include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } }, review: true },
      });
      if (!order) throw notFound('That order could not be found.');
      const business = await prisma.business.findUnique({
        where: { id: order.businessId },
        select: { id: true, name: true, slug: true, publicPhone: true, publicEmail: true },
      });
      res.json({ order: orderToCustomer(order), business });
    }),
  );

  /** One review per completed order. */
  router.post(
    '/:orderId/review',
    publicLimiter,
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(reviewSchema, req.body);
      const order = await prisma.order.findFirst({
        where: { id: req.params.orderId, customerId: req.auth!.profile.id },
        include: { review: true, items: true },
      });
      if (!order) throw notFound('That order could not be found.');
      if (order.status !== 'COMPLETED') {
        throw conflict('You can review an order once the business marks it as completed.');
      }
      if (order.review) throw conflict('You have already reviewed this order.');

      const invalidTags = (body.tags ?? []).filter((tag) => !REVIEW_TAG_IDS.includes(tag));
      if (invalidTags.length > 0) {
        throw badRequest(`Unknown review tags: ${invalidTags.join(', ')}.`);
      }

      const review = await prisma.orderReview.create({
        data: {
          orderId: order.id,
          businessId: order.businessId,
          customerId: req.auth!.profile.id,
          rating: body.rating,
          comment: body.comment ?? null,
          tags: body.tags ?? [],
        },
      });

      const business = await prisma.business.findUnique({ where: { id: order.businessId } });
      if (business) {
        try {
          await notifyBusinessNewReview({ prisma, email: deps.email, frontendUrl: deps.frontendUrl }, review, business);
        } catch (error) {
          logger.warn('review notification threw', { reason: (error as Error).message });
        }
      }

      res.status(201).json({ review: reviewToPublic(review) });
    }),
  );

  return router;
}

export const customerOrderSchemas = { quoteSchema, createSchema, reviewSchema, forbidden };
