import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../middleware/error';
import { publicLimiter } from '../middleware/rateLimit';
import { parseBody, parseQuery } from '../lib/validate';
import { badRequest, notFound } from '../lib/errors';
import { computeOpenState } from '../lib/hours';
import { productToPublic, businessToPublic, reviewToPublic } from '../services/serializers';
import { scoreProduct, tokenize } from '../services/search';
import type { AppDeps } from '../app';

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

const productQuery = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  availability: z.enum(['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(5000).optional(),
});

const recentQuery = z.object({ ids: z.string().trim().max(600).optional() });

export function publicBusinessRouter(deps: AppDeps): Router {
  const router = Router();
  const { prisma } = deps;

  router.get(
    '/',
    publicLimiter,
    asyncHandler(async (req, res) => {
      const query = parseQuery(listQuery, req.query);
      const limit = query.limit ?? 30;
      const search = query.search?.trim();

      const where: Prisma.BusinessWhereInput = { isActive: true, isPublic: true };
      if (query.category) where.category = query.category as Prisma.BusinessWhereInput['category'];
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { searchText: { contains: search.toLowerCase() } },
          { addressLine: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [businesses, total] = await Promise.all([
        prisma.business.findMany({
          where,
          include: { hours: true, _count: { select: { products: { where: { isArchived: false } } } } },
          orderBy: [{ name: 'asc' }],
          take: limit,
          skip: query.offset ?? 0,
        }),
        prisma.business.count({ where }),
      ]);

      res.json({
        total,
        businesses: businesses.map((business) => businessToPublic(business, computeOpenState(business.hours))),
      });
    }),
  );

  router.get(
    '/recent',
    asyncHandler(async (req, res) => {
      const query = parseQuery(recentQuery, req.query);
      const ids = (query.ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 60)
        .slice(0, 12);
      if (ids.length === 0) {
        res.json({ businesses: [] });
        return;
      }
      const businesses = await prisma.business.findMany({
        where: { id: { in: ids }, isActive: true, isPublic: true },
        include: { hours: true, _count: { select: { products: { where: { isArchived: false } } } } },
      });
      const ordered = ids
        .map((id) => businesses.find((business) => business.id === id))
        .filter((business): business is (typeof businesses)[number] => Boolean(business));
      res.json({
        businesses: ordered.map((business) => businessToPublic(business, computeOpenState(business.hours))),
      });
    }),
  );

  router.get(
    '/:businessId',
    publicLimiter,
    asyncHandler(async (req, res) => {
      const { businessId } = req.params;
      const business = await prisma.business.findFirst({
        where: {
          isActive: true,
          isPublic: true,
          OR: [{ id: businessId }, { slug: businessId }],
        },
        include: { hours: true, faqs: true, _count: { select: { products: { where: { isArchived: false } } } } },
      });
      if (!business) throw notFound('That business could not be found.');

      const reviews = await prisma.orderReview.findMany({
        where: { businessId: business.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const aggregate = await prisma.orderReview.aggregate({
        where: { businessId: business.id },
        _avg: { rating: true },
        _count: { _all: true },
      });

      res.json({
        business: businessToPublic(business, computeOpenState(business.hours)),
        rating: {
          average: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null,
          count: aggregate._count._all,
        },
        reviews: reviews.map(reviewToPublic),
      });
    }),
  );

  router.get(
    '/:businessId/products',
    publicLimiter,
    asyncHandler(async (req, res) => {
      const { businessId } = req.params;
      const query = parseQuery(productQuery, req.query);

      const business = await prisma.business.findFirst({
        where: { isActive: true, isPublic: true, OR: [{ id: businessId }, { slug: businessId }] },
        select: { id: true, name: true },
      });
      if (!business) throw notFound('That business could not be found.');

      const where: Prisma.ProductWhereInput = { businessId: business.id, isArchived: false };
      if (query.category) where.category = { equals: query.category, mode: 'insensitive' };
      if (query.availability) where.availability = query.availability;

      const products = await prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        take: 500,
      });

      const search = query.search?.trim() ?? '';
      const tokens = tokenize(search);
      const filtered = tokens.length
        ? products
            .map((product) => ({ product, score: scoreProduct(product, tokens) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
            .map((entry) => entry.product)
        : products;

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 60;
      res.json({
        businessId: business.id,
        businessName: business.name,
        total: filtered.length,
        products: filtered.slice(offset, offset + limit).map(productToPublic),
      });
    }),
  );

  return router;
}

export const publicBusinessSchemas = { listQuery, productQuery, parseBody };
