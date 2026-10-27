import { prisma } from '../../lib/prisma.js';
import { visibleProfileWhere } from '../../lib/profileVisibility.js';
import { providerLocationInclude, viewerCoords, withPublicLocation } from '../../lib/providerLocation.js';
import { todayInIndia, withViewerEventState } from '../../lib/eventTiming.js';
import { eventRatingMap, spRatingMap } from '../../lib/ratings.js';
import { visibleMembersWhere } from '../members/members.service.js';
import { POINTS_PER_REFERRAL } from '../referrals/referrals.service.js';
// Circular with feed.service, which imports this module's scope helpers — safe because both
// sides only call each other's functions at request time, never while loading.
import { decorateDiscussions } from '../feed/feed.service.js';

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

/** [sanitizeAreaOverride] for several areas: only those in the caller's own city. */
export async function sanitizeAreaIds(areaIds: number[] | undefined, cityId: number | null): Promise<number[]> {
  if (!areaIds?.length || !cityId) return [];
  const areas = await prisma.area.findMany({ where: { id: { in: areaIds }, cityId }, select: { id: true } });
  return areas.map((a) => a.id);
}

/**
 * The address filter for a list endpoint. Several picked areas (a Home section's multi-area
 * dropdown, BUG-086) win over the scope; none valid falls back to the scope and single
 * picked area, exactly as before.
 */
export async function listAddressFilter(
  scope: HomeScope,
  ctx: ScopeContext,
  params: { areaId?: number; areaIds?: number[] },
): Promise<Record<string, unknown>> {
  const areaIds = await sanitizeAreaIds(params.areaIds, ctx.cityId);
  if (areaIds.length) return { areaId: { in: areaIds } };
  return addressScopeFilter(scope, ctx, await sanitizeAreaOverride(params.areaId, ctx.cityId));
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

/** The name of the place `addressScopeFilter` actually filters by — same fallbacks, so the
 *  app's "… in <label>" headers can never disagree with the data under them: the society,
 *  else the lane, else the area (picked or the member's own), else the city. */
export async function scopeLabel(
  scope: HomeScope,
  ctx: ScopeContext,
  overrideAreaId: number | null,
  cityName: string | null,
): Promise<string | null> {
  const areaId = overrideAreaId ?? ctx.areaId;
  if (scope === 'society' && areaId && ctx.apartment) return ctx.apartment;
  if ((scope === 'society' || scope === 'lane') && areaId && ctx.lane1) return ctx.lane1;
  if (scope !== 'city' && areaId) {
    const area = await prisma.area.findUnique({ where: { id: areaId }, select: { areaName: true } });
    return area?.areaName ?? cityName;
  }
  return cityName;
}

export const HOME_SCOPES: readonly HomeScope[] = ['society', 'lane', 'area', 'city'] as const;

export type ScopeCounts = Record<HomeScope, number>;

/** How many results each My Society/Lane/Area/City chip would surface — the badge next to
 *  the chip label. Counts the three things the search bar can actually turn up (service
 *  providers + events + groups), which is what Discover's "All" tab searches across.
 *
 *  `addressScopeFilter` degrades to the next broader level when the caller hasn't filled in
 *  an apartment or lane, so two chips frequently resolve to an identical query; identical
 *  filters are counted once and the result shared, keeping this to 3-6 counts rather than 12. */
async function countByScope(
  userId: number,
  ctx: ScopeContext,
  overrideAreaId: number | null,
): Promise<ScopeCounts> {
  const keyOf: Record<string, string> = {};
  const unique = new Map<string, Record<string, unknown>>();
  for (const scope of HOME_SCOPES) {
    const filter = addressScopeFilter(scope, ctx, overrideAreaId);
    const key = JSON.stringify(filter);
    keyOf[scope] = key;
    if (!unique.has(key)) unique.set(key, filter);
  }

  const entries = [...unique.entries()];
  const totals = await Promise.all(
    entries.map(async ([, filter]) => {
      const has = Object.keys(filter).length > 0;
      const creatorWhere = has ? { creator: { profile: { address: filter } } } : {};
      const spWhere = { ...(has ? { address: filter } : {}), AND: [visibleProfileWhere(ctx)] };
      const [sps, events, groups] = await Promise.all([
        prisma.profile.count({
          where: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spWhere },
        }),
        prisma.event.count({ where: { isActive: true, ...creatorWhere } }),
        prisma.interestGroup.count({ where: { isActive: true, ...creatorWhere } }),
      ]);
      return sps + events + groups;
    }),
  );

  const byKey = new Map(entries.map(([key], i) => [key, totals[i]]));
  return {
    society: byKey.get(keyOf.society) ?? 0,
    lane: byKey.get(keyOf.lane) ?? 0,
    area: byKey.get(keyOf.area) ?? 0,
    city: byKey.get(keyOf.city) ?? 0,
  };
}

/** The service-type shortcut row above the provider list: which services actually exist in
 *  scope and how many providers offer each. Counted across every provider in scope rather
 *  than derived from the 8 returned items, so the badge is a real total and the busiest
 *  services lead — the client can only see whichever handful the page happened to include. */
async function countByService(userId: number, spWhere: Record<string, unknown>, take = 6) {
  const grouped = await prisma.profileServiceType.groupBy({
    by: ['subcategoryId'],
    where: {
      profile: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spWhere },
      // Every category ends in an "Other" catch-all. It is a real subcategory providers pick,
      // but as a browse shortcut it says nothing, and it outranks named services often enough
      // to take one of the three visible slots.
      NOT: { subcategory: { name: { in: ['Other', 'Others'] } } },
    },
    _count: { profileId: true },
    orderBy: { _count: { profileId: 'desc' } },
    take,
  });
  if (grouped.length === 0) return [];

  const subs = await prisma.serviceSubcategory.findMany({
    where: { id: { in: grouped.map((g) => g.subcategoryId) } },
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  const byId = new Map(subs.map((s) => [s.id, s]));

  return grouped
    .map((g) => {
      const sub = byId.get(g.subcategoryId);
      return sub ? { id: sub.id, name: sub.name, category: sub.category.name, count: g._count.profileId } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

/** Aggregated payload powering the Home screen. */
export async function getHomeFeed(userId: number, opts: { scope?: HomeScope; areaId?: number } = {}) {
  const scope = opts.scope ?? 'city';
  const ctx = await resolveUserScopeContext(userId);
  const overrideAreaId = await sanitizeAreaOverride(opts.areaId, ctx.cityId);
  const addressFilter = addressScopeFilter(scope, ctx, overrideAreaId);
  const hasFilter = Object.keys(addressFilter).length > 0;
  const cityId = ctx.cityId;

  const [city, viewer] = await Promise.all([
    cityId ? prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true, state: true } }) : null,
    viewerCoords(userId),
  ]);

  const cityWhere = hasFilter ? { creator: { profile: { address: addressFilter } } } : {};
  const postCityWhere = hasFilter ? { user: { profile: { address: addressFilter } } } : {};
  // Providers the viewer may see (Profile visibility) — the list, its count and the service
  // badges all use this, so the numbers match the list behind them.
  const spCityWhere = { ...(hasFilter ? { address: addressFilter } : {}), AND: [visibleProfileWhere(ctx)] };
  // Same rule as the Members list, so the tile's number matches the list behind it.
  const memberWhere = visibleMembersWhere(userId, ctx, addressFilter);

  const [discussions, groups, workshops, serviceProviders, groupCount, workshopCount, spCount, memberCount, stats, scopeCounts, spServices] =
    await Promise.all([
      prisma.post.findMany({
        where: { isActive: true, ...postCityWhere },
        orderBy: { createdAt: 'desc' },
        // Home shows at most 3 discussions, then "See all discussions".
        take: 3,
        include: {
          user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
          // `shares` too, so the card's share count matches the feed's.
          _count: { select: { likes: true, comments: true, shares: true } },
          media: { take: 1, orderBy: { sortOrder: 'asc' } },
        },
      }),
      prisma.interestGroup.findMany({
        where: { isActive: true, ...cityWhere },
        orderBy: { createdAt: 'desc' },
        take: 6,
        // Joined members only — the group page and Discover count the same way.
        include: { _count: { select: { members: { where: { status: 'joined' } } } } },
      }),
      prisma.event.findMany({
        // From today on, soonest first: past events used to fill the row, oldest first.
        where: { isActive: true, date: { gte: todayInIndia() }, ...cityWhere },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        take: 6,
        include: {
          // The workshop card's "By: <name>" line.
          creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
          _count: { select: { attendees: true } },
        },
      }),
      prisma.profile.findMany({
        where: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spCityWhere },
        orderBy: { createdAt: 'desc' },
        // Home shows 3 by default, but tapping a service shortcut filters this same list
        // client-side against the shortcut's badge count — too small a page and the list
        // comes up visibly short of the number on the badge.
        take: 20,
        include: {
          // All approved services: a card shows the first + N, and a service shortcut filters
          // on any of them (BUG-099).
          serviceTypes: { where: { subcategory: { isActive: true } }, include: { subcategory: true } },
          _count: { select: { ratings: true } },
          ...providerLocationInclude,
        },
      }),
      prisma.interestGroup.count({ where: { isActive: true, ...cityWhere } }),
      prisma.event.count({ where: { isActive: true, date: { gte: todayInIndia() }, ...cityWhere } }),
      prisma.profile.count({
        where: { user: { id: { not: userId }, userType: 'service_provider', isActive: true }, ...spCityWhere },
      }),
      prisma.profile.count({ where: memberWhere }),
      prisma.userStats.findUnique({ where: { userId } }),
      countByScope(userId, ctx, overrideAreaId),
      countByService(userId, spCityWhere),
    ]);

  // Same rating lookups the Discover lists use, so a card shows the same stars on both.
  const [workshopRatings, spRatings, workshopsWithState] = await Promise.all([
    eventRatingMap(workshops.map((e) => e.id)),
    spRatingMap(serviceProviders.map((p) => p.id)),
    withViewerEventState(workshops, userId),
  ]);

  return {
    city,
    stats: { members: memberCount, serviceProviders: spCount, events: workshopCount },
    referral: {
      pointsPerReferral: POINTS_PER_REFERRAL,
      message: `Earn ₹${POINTS_PER_REFERRAL} for every friend you refer`,
      balance: stats?.referralPointsBalance ?? 0,
    },
    // Names the location every section is filtered by (see scopeLabel).
    scopeLabel: await scopeLabel(scope, ctx, overrideAreaId, city?.name ?? null),
    discussions: await decorateDiscussions(discussions, userId),
    groups: { total: groupCount, items: groups },
    workshops: {
      total: workshopCount,
      // Today's events that have already finished drop out too.
      items: workshopsWithState.filter((e) => !e.hasEnded).map((e) => ({
        ...e,
        ratingAvg: workshopRatings.get(e.id)?.avg ?? null,
        ratingCount: workshopRatings.get(e.id)?.count ?? 0,
      })),
    },
    serviceProviders: {
      total: spCount,
      items: serviceProviders.map((p) => ({
        ...withPublicLocation(p, viewer),
        ratingAvg: spRatings.get(p.id)?.avg ?? null,
        ratingCount: spRatings.get(p.id)?.count ?? p._count.ratings,
      })),
      services: spServices,
    },
    scopeCounts,
  };
}
