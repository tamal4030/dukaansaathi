import type { Business, BusinessMember, UserProfile } from '@prisma/client';
import type { Db } from '../db/prisma';
import { forbidden, notFound } from '../lib/errors';

export type BusinessWithRole = Business & { role: BusinessMember['role'] };

/**
 * Server-side authorization for every merchant operation. The business id
 * always comes from the route/session - never from a prompt or the client body.
 */
export async function requireBusinessAccess(
  prisma: Db,
  businessId: string,
  profile: UserProfile,
): Promise<BusinessWithRole> {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw notFound('Business not found.');

  const membership = await prisma.businessMember.findFirst({
    where: { businessId, userId: profile.id },
  });

  const isOwner = business.ownerId === profile.id || membership?.role === 'OWNER';
  if (membership || isOwner) {
    return { ...business, role: membership?.role ?? 'OWNER' };
  }
  // Do not leak whether the business exists.
  throw notFound('Business not found.');
}

export async function listBusinessesForUser(prisma: Db, profile: UserProfile) {
  const memberships = await prisma.businessMember.findMany({
    where: { userId: profile.id },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length > 0) return memberships.map((membership) => membership.business);

  // Fallback for businesses created before the membership row existed.
  return prisma.business.findMany({ where: { ownerId: profile.id }, orderBy: { createdAt: 'asc' } });
}

export function assertCanManageProducts(role: BusinessMember['role']): void {
  if (!['OWNER', 'MANAGER'].includes(role)) {
    throw forbidden('Your role cannot change the product catalog.');
  }
}
