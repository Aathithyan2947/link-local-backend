import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { resolveUserCityId } from '../home/home.service.js';

const byCreatorCity = (cityId: number | null) =>
  cityId ? { creator: { profile: { address: { area: { cityId } } } } } : {};

/** Rounds an average to one decimal, or null when there are no ratings. */
const round1 = (avg: number | null | undefined) =>
  avg == null ? null : Math.round(avg * 10) / 10;

/** Builds an { eventId → { avg, count } } lookup for event ratings. */
async function eventRatingMap(eventIds: number[]) {
  if (eventIds.length === 0) return new Map<number, { avg: number | null; count: number }>();
  const groups = await prisma.eventRating.groupBy({
    by: ['eventId'],
    where: { eventId: { in: eventIds }, rating: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  return new Map(groups.map((g) => [g.eventId, { avg: round1(g._avg.rating), count: g._count.rating }]));
}

/** Builds a { profileId → { avg, count } } lookup for service-provider ratings. */
async function spRatingMap(profileIds: number[]) {
  if (profileIds.length === 0) return new Map<number, { avg: number | null; count: number }>();
  const groups = await prisma.serviceProviderRating.groupBy({
    by: ['profileId'],
    where: { profileId: { in: profileIds } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  return new Map(groups.map((g) => [g.profileId, { avg: round1(g._avg.rating), count: g._count.rating }]));
}

// ── Events / Workshops ───────────────────────────────────────
export async function listEvents(userId: number, params: PaginationParams & { q?: string }) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = { isActive: true, ...byCreatorCity(cityId) };
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        _count: { select: { attendees: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.event.count({ where }),
  ]);
  const ratings = await eventRatingMap(items.map((e) => e.id));
  const enriched = items.map((e) => ({
    ...e,
    ratingAvg: ratings.get(e.id)?.avg ?? null,
    ratingCount: ratings.get(e.id)?.count ?? 0,
  }));
  return { items: enriched, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getEvent(id: number) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
      rawMaterials: true,
      _count: { select: { attendees: true } },
    },
  });
  if (!event) throw ApiError.notFound('Event not found');
  return event;
}

// ── Interest Groups ──────────────────────────────────────────
export async function listGroups(userId: number, params: PaginationParams & { q?: string }) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = { isActive: true, ...byCreatorCity(cityId) };
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.interestGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        _count: { select: { members: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.interestGroup.count({ where }),
  ]);
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getGroup(id: number) {
  const group = await prisma.interestGroup.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
      _count: { select: { members: true } },
    },
  });
  if (!group) throw ApiError.notFound('Group not found');
  return group;
}

// ── Service Providers ────────────────────────────────────────
export async function listServiceProviders(
  userId: number,
  params: PaginationParams & { q?: string; subcategoryId?: number },
) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = {
    user: { userType: 'service_provider', isActive: true },
  };
  if (cityId) where.address = { area: { cityId } };
  if (params.q) where.name = { contains: params.q, mode: 'insensitive' };
  if (params.subcategoryId)
    where.serviceTypes = { some: { subcategoryId: params.subcategoryId } };

  const [items, total] = await Promise.all([
    prisma.profile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        serviceTypes: { include: { subcategory: true } },
        _count: { select: { ratings: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.profile.count({ where }),
  ]);
  const ratings = await spRatingMap(items.map((p) => p.id));
  const enriched = items.map((p) => ({
    ...p,
    ratingAvg: ratings.get(p.id)?.avg ?? null,
    ratingCount: ratings.get(p.id)?.count ?? p._count.ratings,
  }));
  return { items: enriched, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getServiceProvider(id: number) {
  const sp = await prisma.profile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, userType: true, mobile: true } },
      address: { include: { area: { include: { city: true } } } },
      educations: true,
      professions: { include: { professionMaster: true } },
      serviceTypes: { include: { subcategory: { include: { category: true } } } },
      products: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } },
      media: { orderBy: { sortOrder: 'asc' } },
      delivery: true,
      paymentTerms: true,
      ratings: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          rater: { select: { id: true, userType: true, profile: { select: { name: true } } } },
        },
      },
    },
  });
  if (!sp) throw ApiError.notFound('Service provider not found');

  const userId = sp.userId;
  const eventInclude = {
    creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
    _count: { select: { attendees: true } },
  };

  const [ragg, hosted, attending, posts, adminGroups, memberGroups] = await Promise.all([
    prisma.serviceProviderRating.aggregate({
      where: { profileId: id },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.event.findMany({
      where: { creatorId: userId, isActive: true },
      orderBy: { date: 'desc' },
      take: 10,
      include: eventInclude,
    }),
    prisma.event.findMany({
      where: { isActive: true, attendees: { some: { userId, status: 'joined' } } },
      orderBy: { date: 'desc' },
      take: 10,
      include: eventInclude,
    }),
    prisma.post.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        media: { take: 1, orderBy: { sortOrder: 'asc' } },
        _count: { select: { likes: true, comments: true } },
      },
    }),
    prisma.interestGroupAdmin.findMany({
      where: { userId },
      include: { group: { include: { _count: { select: { members: true } } } } },
    }),
    prisma.interestGroupMember.findMany({
      where: { userId, status: 'joined' },
      include: { group: { include: { _count: { select: { members: true } } } } },
    }),
  ]);

  // Tag + dedupe events (hosting wins over attending) and attach rating averages.
  const hostedIds = new Set(hosted.map((e) => e.id));
  const eventRows = [
    ...hosted.map((e) => ({ ...e, relation: 'hosting' as const })),
    ...attending.filter((e) => !hostedIds.has(e.id)).map((e) => ({ ...e, relation: 'attending' as const })),
  ];
  const eventRatings = await eventRatingMap(eventRows.map((e) => e.id));
  const events = eventRows.map((e) => ({ ...e, ratingAvg: eventRatings.get(e.id)?.avg ?? null }));

  // Tag + dedupe interest groups (admin wins over member).
  const adminGroupIds = new Set(adminGroups.map((a) => a.groupId));
  const groups = [
    ...adminGroups.map((a) => ({ ...a.group, role: 'admin' as const })),
    ...memberGroups
      .filter((m) => !adminGroupIds.has(m.groupId))
      .map((m) => ({ ...m.group, role: 'member' as const })),
  ];

  return {
    ...sp,
    ratingAvg: round1(ragg._avg.rating),
    ratingCount: ragg._count.rating,
    events,
    posts,
    groups,
  };
}

/** Create (or update) the current user's review of a service provider. */
export async function rateServiceProvider(
  profileId: number,
  raterId: number,
  data: { rating: number; review?: string },
) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, userId: true },
  });
  if (!profile) throw ApiError.notFound('Service provider not found');
  if (profile.userId === raterId) throw ApiError.badRequest('You cannot review your own profile');

  const existing = await prisma.serviceProviderRating.findFirst({
    where: { profileId, ratedBy: raterId },
  });
  if (existing) {
    return prisma.serviceProviderRating.update({
      where: { id: existing.id },
      data: { rating: data.rating, review: data.review ?? null },
    });
  }
  return prisma.serviceProviderRating.create({
    data: { profileId, ratedBy: raterId, rating: data.rating, review: data.review ?? null },
  });
}
