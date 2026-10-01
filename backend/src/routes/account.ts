import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error';
import { parseBody } from '../lib/validate';
import { notFound } from '../lib/errors';
import { profileToPublic, businessToPublic } from '../services/serializers';
import { computeOpenState } from '../lib/hours';
import type { AppDeps } from '../app';
import type { createAuthMiddleware } from '../middleware/auth';

type Auth = ReturnType<typeof createAuthMiddleware>;

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z
    .union([z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, 'Enter a valid phone number.'), z.literal('')])
    .optional(),
  locale: z.enum(['en', 'bn', 'hi']).optional(),
  emailNotificationsOptIn: z.boolean().optional(),
});

const recentSchema = z.object({ businessId: z.string().trim().min(6).max(60) });

export function accountRouter(deps: AppDeps, auth: Auth): Router {
  const router = Router();
  const { prisma } = deps;

  router.get(
    '/profile',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      res.json({ profile: profileToPublic(req.auth!.profile) });
    }),
  );

  router.patch(
    '/profile',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(profileSchema, req.body);
      const updated = await prisma.userProfile.update({
        where: { id: req.auth!.profile.id },
        data: {
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.phone !== undefined ? { phone: body.phone === '' ? null : body.phone } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.emailNotificationsOptIn !== undefined
            ? { emailNotificationsOptIn: body.emailNotificationsOptIn }
            : {}),
        },
      });
      res.json({ profile: profileToPublic(updated) });
    }),
  );

  /** Recently accessed businesses for a signed-in customer (synced across devices). */
  router.get(
    '/recent',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const rows = await prisma.recentBusiness.findMany({
        where: { userId: req.auth!.profile.id, business: { isActive: true, isPublic: true } },
        include: { business: { include: { hours: true } } },
        orderBy: { lastAccessedAt: 'desc' },
        take: 12,
      });
      res.json({
        businesses: rows.map((row) => businessToPublic(row.business, computeOpenState(row.business.hours))),
      });
    }),
  );

  router.post(
    '/recent',
    auth.requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(recentSchema, req.body);
      const business = await prisma.business.findFirst({
        where: { id: body.businessId, isActive: true, isPublic: true },
        select: { id: true },
      });
      if (!business) throw notFound('That business could not be found.');
      const row = await prisma.recentBusiness.upsert({
        where: { userId_businessId: { userId: req.auth!.profile.id, businessId: business.id } },
        update: { lastAccessedAt: new Date() },
        create: { userId: req.auth!.profile.id, businessId: business.id },
      });
      res.status(201).json({ recent: { businessId: row.businessId, lastAccessedAt: row.lastAccessedAt } });
    }),
  );

  return router;
}
