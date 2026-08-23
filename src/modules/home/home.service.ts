import { prisma } from '../../lib/prisma.js';
import { POINTS_PER_REFERRAL } from '../referrals/referrals.service.js';

/** Resolves a user's active city id (primary membership, else profile address). */
export async function resolveUserCityId(userId: number): Promise<number | null> {
  const membership = await prisma.userCityMembership.findFirst({
    where: { userId, isPrimary: true },
  });
  if (membership) return membership.cityId;

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { address: { select: { area: { select: { cityId: true } } } } },
  });
  return profile?.address?.area?.cityId ?? null;
}

export type HomeScope = 'society' | 'lane' | 'area' | 'city';

export interface ScopeContext {
  cityId: number | null;
  areaId: number | null;
  apartment: string | null;
  lane1: string | null;
}

/** Resolves the caller's own address-derived scope context (society/lane/area/city). Falls
 *  back to their primary city membership (no areaId/apartment/lane1) when they have no
 *  address yet, mirroring `resolveUserCityId`'s existing fallback. Exported so
 *  `discovery.service.ts` can apply the same per-section area scoping to the
 *  service-providers/events/groups list endpoints that Home already uses. */
export async function resolveUserScopeContext(userId: number): Promise<ScopeContext> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: {
      address: { select: { areaId: true, apartment: true, lane1: true, area: { select: { cityId: true } } } },
    },
  });
  const address = profile?.address;
  if (address) {
    return {
      cityId: address.area?.cityId ?? null,
      areaId: address.areaId,
      apartment: address.apartment?.trim() || null,
      lane1: address.lane1?.trim() || null,
    };
  }
  return { cityId: await resolveUserCityId(userId), areaId: null, apartment: null, lane1: null };
}

/** Defense in depth: an explicit area override (from the location picker) must belong to the
 *  caller's own city — the Flutter picker already only lists the user's own city. */
export async function sanitizeAreaOverride(areaId: number | undefined, cityId: number | null): Promise<number | null> {
  if (!areaId || !cityId) return null;
  const area = await prisma.area.findUnique({ where: { id: areaId }, select: { cityId: true } });
  return area?.cityId === cityId ? areaId : null;
}

/** One shared Address-shaped where-fragment, reused by every query below. Degrades to the
 *  next broader level when the sharper field is missing (e.g. the user hasn't filled in an
 *  apartment/lane name) so a scope pick never silently returns zero results. */
export function addressScopeFilter(
  scope: HomeScope,
  ctx: ScopeContext,
  overrideAreaId: number | null,
): Record<string, unknown> {
  const areaId = overrideAreaId ?? ctx.areaId;
  if (scope === 'society' && areaId && ctx.apartment) {
    return { areaId, apartment: { equals: ctx.apartment, mode: 'insensitive' } };
  }
  if ((scope === 'society' || scope === 'lane') && areaId && ctx.lane1) {
    return { areaId, lane1: { equals: ctx.lane1, mode: 'insensitive' } };
  }
  if (scope !== 'city' && areaId) return { areaId };
  return ctx.cityId ? { area: { cityId: ctx.cityId } } : {};
}

/** Aggregated payload powering the Home screen. */
export async function getHomeFeed(userId: number, opts: { scope?: HomeScope; areaId?: number } = {}) {
  const scope = opts.scope ?? 'city';
  const ctx = await resolveUserScopeContext(userId);
  const overrideAreaId = await sanitizeAreaOverride(opts.areaId, ctx.cityId);
  const addressFilter = addressScopeFilter(scope, ctx, overrideAreaId);
  const hasFilter = Object.keys(addressFilter).length > 0;
  const cityId = ctx.cityId;

  const city = cityId
    ? await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true, state: true } })
    : null;

  const cityWhere = hasFilter ? { creator: { profile: { address: addressFilter } } } : {};
  const postCityWhere = hasFilter ? { user: { profile: { address: addressFilter } } } : {};
  const spCityWhere = hasFilter ? { address: addressFilter } : {};
  const memberWhere = hasFilter ? { address: addressFilter } : {};

  const [discussions, groups, workshops, serviceProviders, groupCount, workshopCount, spCount, memberCount, stats] =
    await Promise.all([
      prisma.post.findMany({
        where: { isActive: true, ...postCityWhere },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
          _count: { select: { likes: true, comments: true } },
          media: { take: 1, orderBy: { sortOrder: 'asc' } },
        },
      }),
      prisma.interestGroup.findMany({
        where: { isActive: true, ...cityWhere },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { _count: { select: { members: true } } },
      }),
      prisma.event.findMany({
        where: { isActive: true, ...cityWhere },
        orderBy: { date: 'asc' },
        take: 6,
        include: { _count: { select: { attendees: true } } },
      }),
      prisma.profile.findMany({
        where: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spCityWhere },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          serviceTypes: { include: { subcategory: true }, take: 2 },
          _count: { select: { ratings: true } },
        },
      }),
      prisma.interestGroup.count({ where: { isActive: true, ...cityWhere } }),
      prisma.event.count({ where: { isActive: true, ...cityWhere } }),
      prisma.profile.count({
        where: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spCityWhere },
      }),
      prisma.profile.count({ where: memberWhere }),
      prisma.userStats.findUnique({ where: { userId } }),
    ]);

  return {
    city,
    stats: { members: memberCount, serviceProviders: spCount, events: workshopCount },
    referral: {
      pointsPerReferral: POINTS_PER_REFERRAL,
      message: `Earn ₹${POINTS_PER_REFERRAL} for every friend you refer`,
      balance: stats?.referralPointsBalance ?? 0,
    },
    discussions,
    groups: { total: groupCount, items: groups },
    workshops: { total: workshopCount, items: workshops },
    serviceProviders: { total: spCount, items: serviceProviders },
  };
}
