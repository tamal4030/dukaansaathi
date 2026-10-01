import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/error';
import { publicLimiter } from '../middleware/rateLimit';
import { uploadSpreadsheet } from '../middleware/upload';
import { badRequest, conflict, notFound } from '../lib/errors';
import { parseBody, parseQuery } from '../lib/validate';
import { BUSINESS_CATEGORY_IDS, categoryLabel } from '../lib/categories';
import { availabilityLabel, AVAILABILITY_VALUES } from '../lib/availability';
import { computeOpenState, DAY_NAMES, validateHourInput } from '../lib/hours';
import { allowedTransitions, statusLabel } from '../lib/orderStatus';
import { slugify, uniqueSlugSuffix } from '../lib/slug';
import { money } from '../lib/money';
import { parseProductFile } from '../services/products/importService';
import {
  buildImportTemplate,
  buildProductsCsv,
  buildProductsWorkbook,
} from '../services/products/exportService';
import { assertCanManageProducts, listBusinessesForUser, requireBusinessAccess } from '../services/businessAccess';
import { updateOrderStatus } from '../services/orders';
import { notifyCustomerOrderStatus } from '../services/notifications';
import { businessToMerchant, orderToMerchant, productToMerchant, reviewToMerchant } from '../services/serializers';
import { logger } from '../lib/logger';
import type { AppDeps } from '../app';
import type { createAuthMiddleware } from '../middleware/auth';

type Auth = ReturnType<typeof createAuthMiddleware>;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const createBusinessSchema = z.object({
  name: z.string().trim().min(2, 'Add your business name.').max(120),
  category: z.enum(BUSINESS_CATEGORY_IDS as [string, ...string[]], {
    errorMap: () => ({ message: 'Choose one of the listed business categories.' }),
  }),
  ownerName: z.string().trim().min(2, 'Add the owner name.').max(120),
  addressLine: z.string().trim().min(5, 'Add the shop address (street or landmark).').max(200),
  city: z.string().trim().min(2, 'Add the city or town.').max(80),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6 digit PIN code.').optional().or(z.literal('')),
  publicPhone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid public phone number.')
    .optional()
    .or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
});

const hourSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  isClosed: z.boolean().default(false),
  openTime: z.string().trim().regex(timePattern, 'Use 24-hour time like 09:00.').nullish(),
  closeTime: z.string().trim().regex(timePattern, 'Use 24-hour time like 21:00.').nullish(),
  note: z.string().trim().max(120).nullish(),
});

const faqSchema = z.object({
  question: z.string().trim().min(3, 'Add a question.').max(200),
  answer: z.string().trim().min(2, 'Add an answer.').max(1000),
});

const updateBusinessSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  category: z.enum(BUSINESS_CATEGORY_IDS as [string, ...string[]]).optional(),
  description: z.string().trim().max(1000).nullish(),
  publicPhone: z.string().trim().max(20).nullish(),
  publicEmail: z.union([z.string().trim().email('Enter a valid public email.'), z.literal('')]).nullish(),
  addressLine: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().max(80).nullish(),
  pincode: z.string().trim().max(10).nullish(),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  pickupEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  deliveryNotes: z.string().trim().max(300).nullish(),
  paymentMethods: z.array(z.string().trim().max(40)).max(10).optional(),
  returnPolicy: z.string().trim().max(1000).nullish(),
  assistantNotes: z.string().trim().max(2000).nullish(),
  emailNotificationsOptIn: z.boolean().optional(),
  emailNotificationsEmail: z.union([z.string().trim().email('Enter a valid email.'), z.literal('')]).nullish(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  hours: z.array(hourSchema).max(7).optional(),
  faqs: z.array(faqSchema).max(20).optional(),
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required.').max(140),
  price: z.coerce.number().min(0).max(1_000_000),
  availability: z.enum(AVAILABILITY_VALUES as [string, ...string[]], {
    errorMap: () => ({ message: 'Availability must be Available, Out of stock or Unknown.' }),
  }),
  description: z.string().trim().max(1000).nullish(),
  category: z.string().trim().max(60).nullish(),
  aliases: z.array(z.string().trim().max(80)).max(12).optional(),
});

const productPatchSchema = productSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

const statusSchema = z.object({
  status: z.enum(['NEW', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED']),
  note: z.string().trim().max(500).optional(),
});

const orderQuery = z.object({
  status: z
    .enum(['NEW', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'ALL'])
    .optional(),
});

function searchTextFor(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase().slice(0, 500);
}

export function merchantRouter(deps: AppDeps, auth: Auth): Router {
  const router = Router();
  const { prisma } = deps;

  /** Business onboarding: creates the business and its owner membership atomically. */
  router.post(
    '/businesses',
    publicLimiter,
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(createBusinessSchema, req.body);
      const profile = req.auth!.profile;

      const baseSlug = slugify(body.name) || 'store';
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await prisma.business.findUnique({ where: { slug } });
        if (!clash) break;
        slug = `${baseSlug}-${uniqueSlugSuffix()}`;
      }

      const business = await prisma.$transaction(async (tx) => {
        const created = await tx.business.create({
          data: {
            ownerId: profile.id,
            name: body.name,
            slug,
            category: body.category as Prisma.BusinessCreateInput['category'],
            addressLine: body.addressLine,
            city: body.city,
            state: body.state ?? null,
            pincode: body.pincode || null,
            publicPhone: body.publicPhone || null,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
            emailNotificationsEmail: profile.email,
            searchText: searchTextFor([body.name, categoryLabel(body.category), body.city, body.addressLine]),
          },
        });
        await tx.businessMember.create({
          data: { businessId: created.id, userId: profile.id, role: 'OWNER' },
        });
        await tx.userProfile.update({
          where: { id: profile.id },
          data: { role: profile.role === 'ADMIN' ? 'ADMIN' : 'BUSINESS_OWNER', fullName: profile.fullName ?? body.ownerName },
        });
        return created;
      }, {
    // Interactive transactions default to a 5s timeout. Creating an order
    // writes the order, its items and the first status event, and a managed
    // database adds real network latency to each step, so the default is too
    // tight and fails with P2028. The budget below is generous but still
    // bounded, so a genuinely stuck transaction is aborted.
    timeout: 20000,
    maxWait: 10000,
  });

      logger.info('business created', { businessId: business.id, ownerId: profile.id });
      res.status(201).json({ business: businessToMerchant(business, 'unknown') });
    }),
  );

  router.get(
    '/businesses',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const businesses = await listBusinessesForUser(prisma, req.auth!.profile);
      const withHours = await prisma.business.findMany({
        where: { id: { in: businesses.map((business) => business.id) } },
        include: { hours: true },
      });
      res.json({
        businesses: withHours.map((business) => businessToMerchant(business, computeOpenState(business.hours))),
      });
    }),
  );

  router.get(
    '/businesses/:businessId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const business = await prisma.business.findUnique({
        where: { id: access.id },
        include: { hours: true, faqs: true, _count: { select: { products: { where: { isArchived: false } } } } },
      });
      if (!business) throw notFound('Business not found.');
      res.json({
        business: businessToMerchant(business, computeOpenState(business.hours)),
        role: access.role,
      });
    }),
  );

  router.patch(
    '/businesses/:businessId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const body = parseBody(updateBusinessSchema, req.body);

      for (const hour of body.hours ?? []) {
        const error = validateHourInput({ isClosed: hour.isClosed, openTime: hour.openTime ?? null, closeTime: hour.closeTime ?? null });
        if (error) throw badRequest(`${DAY_NAMES[hour.dayOfWeek]}: ${error}`);
      }

      const updated = await prisma.$transaction(async (tx) => {
        const data: Prisma.BusinessUpdateInput = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.category !== undefined ? { category: body.category as Prisma.BusinessUpdateInput['category'] } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.publicPhone !== undefined ? { publicPhone: body.publicPhone || null } : {}),
          ...(body.publicEmail !== undefined ? { publicEmail: body.publicEmail || null } : {}),
          ...(body.addressLine !== undefined ? { addressLine: body.addressLine } : {}),
          ...(body.city !== undefined ? { city: body.city } : {}),
          ...(body.state !== undefined ? { state: body.state } : {}),
          ...(body.pincode !== undefined ? { pincode: body.pincode } : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
          ...(body.pickupEnabled !== undefined ? { pickupEnabled: body.pickupEnabled } : {}),
          ...(body.deliveryEnabled !== undefined ? { deliveryEnabled: body.deliveryEnabled } : {}),
          ...(body.deliveryNotes !== undefined ? { deliveryNotes: body.deliveryNotes } : {}),
          ...(body.paymentMethods !== undefined ? { paymentMethods: body.paymentMethods } : {}),
          ...(body.returnPolicy !== undefined ? { returnPolicy: body.returnPolicy } : {}),
          ...(body.assistantNotes !== undefined ? { assistantNotes: body.assistantNotes } : {}),
          ...(body.emailNotificationsOptIn !== undefined ? { emailNotificationsOptIn: body.emailNotificationsOptIn } : {}),
          ...(body.emailNotificationsEmail !== undefined
            ? { emailNotificationsEmail: body.emailNotificationsEmail || null }
            : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
        };

        if (body.hours) {
          await tx.businessHour.deleteMany({ where: { businessId: access.id } });
          if (body.hours.length > 0) {
            await tx.businessHour.createMany({
              data: body.hours.map((hour) => ({
                businessId: access.id,
                dayOfWeek: hour.dayOfWeek,
                isClosed: hour.isClosed,
                openTime: hour.isClosed ? null : (hour.openTime ?? null),
                closeTime: hour.isClosed ? null : (hour.closeTime ?? null),
                note: hour.note ?? null,
              })),
            });
          }
        }

        if (body.faqs) {
          await tx.businessFaq.deleteMany({ where: { businessId: access.id } });
          if (body.faqs.length > 0) {
            await tx.businessFaq.createMany({
              data: body.faqs.map((faq, index) => ({
                businessId: access.id,
                question: faq.question,
                answer: faq.answer,
                sortOrder: index,
              })),
            });
          }
        }

        const existing = await tx.business.findUnique({ where: { id: access.id } });
        return tx.business.update({
          where: { id: access.id },
          data: {
            ...data,
            searchText: searchTextFor([
              body.name ?? existing?.name,
              categoryLabel((body.category ?? existing?.category) as string),
              body.city ?? existing?.city,
              body.addressLine ?? existing?.addressLine,
            ]),
          },
          include: { hours: true, faqs: true, _count: { select: { products: { where: { isArchived: false } } } } },
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

      res.json({ business: businessToMerchant(updated, computeOpenState(updated.hours)) });
    }),
  );

  /** Dashboard data: every number is calculated from the database. */
  router.get(
    '/businesses/:businessId/overview',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const businessId = access.id;

      const [newOrders, openConversations, preparing, completedOrders, topItems, recentReviews, ratingAgg, productStats] =
        await Promise.all([
          prisma.order.count({ where: { businessId, status: 'NEW' } }),
          prisma.conversation.count({ where: { businessId, status: 'OPEN' } }),
          prisma.order.count({ where: { businessId, status: { in: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'] } } }),
          prisma.order.count({ where: { businessId, status: 'COMPLETED' } }),
          prisma.orderItem.groupBy({
            by: ['nameSnapshot'],
            where: { order: { businessId, status: 'COMPLETED' } },
            _sum: { quantity: true, lineTotal: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
          }),
          prisma.orderReview.findMany({
            where: { businessId },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
          prisma.orderReview.aggregate({ where: { businessId }, _avg: { rating: true }, _count: { _all: true } }),
          prisma.product.groupBy({ by: ['availability'], where: { businessId, isArchived: false }, _count: { _all: true } }),
        ]);

      const recentOrders = await prisma.order.findMany({
        where: { businessId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      res.json({
        needsAttention: {
          newOrders,
          openConversations,
          total: newOrders + openConversations,
        },
        inProgressOrders: preparing,
        completedOrders,
        topProducts: topItems.map((item) => ({
          name: item.nameSnapshot,
          quantitySold: item._sum.quantity ?? 0,
          revenue: money(item._sum.lineTotal ?? new Prisma.Decimal(0)),
        })),
        rating: {
          average: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(2)) : null,
          count: ratingAgg._count._all,
        },
        recentReviews: recentReviews.map(reviewToMerchant),
        productAvailability: AVAILABILITY_VALUES.map((value) => ({
          value,
          label: availabilityLabel(value),
          count: productStats.find((stat) => stat.availability === value)?._count._all ?? 0,
        })),
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          orderCode: order.orderCode,
          status: order.status,
          statusLabel: statusLabel(order.status),
          customerName: order.customerName,
          total: money(order.total),
          itemCount: order.items.length,
          createdAt: order.createdAt,
        })),
      });
    }),
  );

  router.get(
    '/businesses/:businessId/orders',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const query = parseQuery(orderQuery, req.query);
      const orders = await prisma.order.findMany({
        where: {
          businessId: access.id,
          ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
        },
        include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } }, review: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      res.json({
        orders: orders.map(orderToMerchant),
        counts: await prisma.order.groupBy({ by: ['status'], where: { businessId: access.id }, _count: { _all: true } }),
      });
    }),
  );

  router.get(
    '/businesses/:businessId/orders/:orderId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const order = await prisma.order.findFirst({
        where: { id: req.params.orderId, businessId: access.id },
        include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } }, review: true },
      });
      if (!order) throw notFound('That order could not be found for this business.');
      res.json({
        order: orderToMerchant(order),
        nextStatuses: allowedTransitions(order.status, order.fulfillment).map((status) => ({
          id: status,
          label: statusLabel(status),
        })),
      });
    }),
  );

  router.patch(
    '/businesses/:businessId/orders/:orderId/status',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const body = parseBody(statusSchema, req.body);

      const result = await updateOrderStatus(prisma, {
        orderId: req.params.orderId,
        businessId: access.id,
        nextStatus: body.status,
        note: body.note ?? null,
        actorUserId: req.auth!.profile.id,
      });

      let emailOutcome = 'SKIPPED';
      const customer = await prisma.userProfile.findUnique({ where: { id: result.order.customerId } });
      const business = await prisma.business.findUnique({ where: { id: access.id } });
      if (business) {
        try {
          emailOutcome = await notifyCustomerOrderStatus(
            { prisma, email: deps.email, frontendUrl: deps.frontendUrl },
            result.order,
            business,
            customer,
          );
        } catch (error) {
          logger.warn('status notification threw, status change kept', { reason: (error as Error).message });
        }
      }

      res.json({
        order: orderToMerchant(result.order),
        previousStatus: result.previousStatus,
        notifications: {
          customerEmail: emailOutcome,
          note:
            emailOutcome === 'SKIPPED'
              ? 'The customer has not opted in to order emails, so no email was sent.'
              : emailOutcome === 'FAILED'
                ? 'The status was saved, but the customer email could not be delivered.'
                : 'The customer was emailed about the status change.',
        },
      });
    }),
  );

  // ------------------------------- products --------------------------------

  router.get(
    '/businesses/:businessId/products',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const query = req.query as Record<string, string | undefined>;
      const search = (query.search ?? '').trim();
      const products = await prisma.product.findMany({
        where: {
          businessId: access.id,
          ...(query.includeArchived === 'true' ? {} : { isArchived: false }),
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
        orderBy: { name: 'asc' },
        take: 500,
      });
      res.json({ products: products.map(productToMerchant) });
    }),
  );

  router.post(
    '/businesses/:businessId/products',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      assertCanManageProducts(access.role);
      const body = parseBody(productSchema, req.body);
      const product = await prisma.product.create({
        data: {
          businessId: access.id,
          name: body.name,
          price: new Prisma.Decimal(body.price),
          availability: body.availability as Prisma.ProductCreateInput['availability'],
          description: body.description ?? null,
          category: body.category ?? null,
          aliases: body.aliases ?? [],
          searchText: searchTextFor([body.name, body.category, (body.aliases ?? []).join(' ')]),
        },
      });
      res.status(201).json({ product: productToMerchant(product) });
    }),
  );

  router.patch(
    '/businesses/:businessId/products/:productId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      assertCanManageProducts(access.role);
      const body = parseBody(productPatchSchema, req.body);

      const existing = await prisma.product.findFirst({ where: { id: req.params.productId, businessId: access.id } });
      if (!existing) throw notFound('That product could not be found for this business.');

      const product = await prisma.product.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.price !== undefined ? { price: new Prisma.Decimal(body.price) } : {}),
          ...(body.availability !== undefined ? { availability: body.availability as Prisma.ProductUpdateInput['availability'] } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.aliases !== undefined ? { aliases: body.aliases } : {}),
          ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
          searchText: searchTextFor([
            body.name ?? existing.name,
            body.category ?? existing.category,
            (body.aliases ?? existing.aliases).join(' '),
          ]),
        },
      });
      res.json({ product: productToMerchant(product) });
    }),
  );

  /** Archive (soft delete) keeps historical orders readable. */
  router.delete(
    '/businesses/:businessId/products/:productId',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      assertCanManageProducts(access.role);
      const existing = await prisma.product.findFirst({ where: { id: req.params.productId, businessId: access.id } });
      if (!existing) throw notFound('That product could not be found for this business.');
      const archived = await prisma.product.update({ where: { id: existing.id }, data: { isArchived: true } });
      res.json({ product: productToMerchant(archived), note: 'The product was archived and is no longer shown to customers.' });
    }),
  );

  /**
   * Spreadsheet import. mode=preview returns parsed rows and row-level errors
   * without writing anything; mode=commit saves the validated rows.
   */
  router.post(
    '/businesses/:businessId/products/import',
    auth.requireAuth,
    uploadSpreadsheet,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      assertCanManageProducts(access.role);
      if (!req.file) throw badRequest('Choose an .xlsx or .csv file to upload.');

      const mode = (req.query.mode as string) === 'commit' ? 'commit' : 'preview';
      const parsed = await parseProductFile(req.file.buffer, req.file.originalname);
      const errors = parsed.issues.filter((issue) => issue.severity === 'error');

      /**
       * The merchant can deselect rows in the preview before committing.
       * Exclusions arrive as product names (the natural key used for upsert)
       * so they survive re-ordering of the file. Unknown names are ignored.
       */
      const rawExclusions = typeof req.body?.excludeNames === 'string' ? req.body.excludeNames : '';
      let excluded = new Set<string>();
      if (rawExclusions) {
        try {
          const list = JSON.parse(rawExclusions) as unknown;
          if (Array.isArray(list)) {
            excluded = new Set(list.filter((name): name is string => typeof name === 'string').map((name) => name.toLowerCase()));
          }
        } catch {
          throw badRequest('excludeNames must be a JSON array of product names.');
        }
      }
      const selectedRows = parsed.rows.filter((row) => !excluded.has(row.name.toLowerCase()));
      const excludedCount = parsed.rows.length - selectedRows.length;

      if (mode === 'preview') {
        res.json({
          mode,
          filename: req.file.originalname,
          headerMap: parsed.headerMap,
          missingColumns: parsed.missingColumns,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          invalidRows: new Set(errors.map((issue) => issue.row)).size,
          rows: parsed.rows.slice(0, 200),
          issues: parsed.issues.slice(0, 300),
          canCommit: errors.length === 0 && parsed.rows.length > 0,
        });
        return;
      }

      if (errors.length > 0) {
        throw badRequest(
          `The file still has ${errors.length} error${errors.length === 1 ? '' : 's'}. Fix them and upload again - nothing was saved.`,
          { issues: errors.slice(0, 50) },
        );
      }
      if (parsed.rows.length === 0) throw badRequest('No product rows were found in that file.');
      if (selectedRows.length === 0) {
        throw badRequest('Every row was deselected, so there is nothing to save.');
      }

      const result = await prisma.$transaction(async (tx) => {
        let created = 0;
        let updated = 0;
        for (const row of selectedRows) {
          const existing = await tx.product.findFirst({
            where: { businessId: access.id, name: { equals: row.name, mode: 'insensitive' } },
          });
          const data = {
            price: new Prisma.Decimal(row.price),
            availability: row.availability,
            description: row.description,
            category: row.category,
            aliases: row.aliases,
            searchText: searchTextFor([row.name, row.category, row.aliases.join(' ')]),
          };
          if (existing) {
            await tx.product.update({ where: { id: existing.id }, data: { ...data, isArchived: false } });
            updated += 1;
          } else {
            await tx.product.create({ data: { businessId: access.id, name: row.name, ...data } });
            created += 1;
          }
        }
        return { created, updated };
      }, {
    // Interactive transactions default to a 5s timeout. Creating an order
    // writes the order, its items and the first status event, and a managed
    // database adds real network latency to each step, so the default is too
    // tight and fails with P2028. The budget below is generous but still
    // bounded, so a genuinely stuck transaction is aborted.
    timeout: 20000,
    maxWait: 10000,
  });

      res.status(201).json({
        mode,
        saved: true,
        ...result,
        totalRows: parsed.totalRows,
        excluded: excludedCount,
        warnings: parsed.issues.filter((issue) => issue.severity === 'warning').slice(0, 50),
      });
    }),
  );

  router.get(
    '/businesses/:businessId/products/export',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const products = await prisma.product.findMany({
        where: { businessId: access.id, isArchived: false },
        orderBy: { name: 'asc' },
      });
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="dukaansaathi-products-${stamp}.csv"`);
        res.send(buildProductsCsv(products));
        return;
      }
      const buffer = await buildProductsWorkbook(products, { withInstructions: false });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="dukaansaathi-products-${stamp}.xlsx"`);
      res.send(buffer);
    }),
  );

  router.get(
    '/businesses/:businessId/products/template',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const format = (req.query.format as string) === 'csv' ? 'csv' : 'xlsx';
      const withSample = req.query.sample !== 'false';
      if (format === 'csv') {
        // Header only. No example row, so nothing can be imported as real
        // inventory by accident; the example is described in the docs and in
        // the XLSX template's instructions sheet.
        const header = 'Name,Price,Availability,Description,Category,Alternate names';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="dukaansaathi-product-template.csv"');
        res.send(`${header}\n`);
        return;
      }
      const buffer = await buildImportTemplate({ withSample });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="dukaansaathi-product-template.xlsx"');
      res.send(buffer);
    }),
  );

  router.get(
    '/businesses/:businessId/reviews',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const [reviews, aggregate, feedback] = await Promise.all([
        prisma.orderReview.findMany({ where: { businessId: access.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.orderReview.aggregate({ where: { businessId: access.id }, _avg: { rating: true }, _count: { _all: true } }),
        prisma.conversationFeedback.findMany({
          where: { conversation: { businessId: access.id } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);
      res.json({
        rating: {
          average: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null,
          count: aggregate._count._all,
        },
        reviews: reviews.map((review) => ({ ...reviewToMerchant(review), source: 'ORDER' })),
        conversationFeedback: feedback.map((item) => ({
          id: item.id,
          rating: item.rating,
          comment: item.comment,
          createdAt: item.createdAt,
          source: 'CONVERSATION',
        })),
        note: 'Customer email and phone numbers are never shown here.',
      });
    }),
  );

  router.get(
    '/businesses/:businessId/conversations/counts',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const access = await requireBusinessAccess(prisma, req.params.businessId, req.auth!.profile);
      const counts = await prisma.conversation.groupBy({ by: ['status'], where: { businessId: access.id }, _count: { _all: true } });
      res.json({
        open: counts.find((entry) => entry.status === 'OPEN')?._count._all ?? 0,
        resolved: counts.find((entry) => entry.status === 'RESOLVED')?._count._all ?? 0,
      });
    }),
  );

  return router;
}

export const merchantSchemas = { createBusinessSchema, updateBusinessSchema, productSchema, statusSchema, conflict };
