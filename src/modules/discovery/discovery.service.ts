import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { resolveUserCityId } from '../home/home.service.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';
import { mockCharge } from '../../lib/payments.js';
import { resolveCoupon, redeemCoupon } from '../../lib/coupons.js';

/** Parses an ISO date/time string into a Date, or null. Used for @db.Time/@db.Date. */
function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  // Accept "HH:mm" for time-only fields as well as full ISO strings.
  const iso = /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? `1970-01-01T${v.length === 5 ? v + ':00' : v}.000Z` : v;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const eventCardInclude = {
  creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  _count: { select: { attendees: true } },
};

export interface CreateEventInput {
  title: string;
  description?: string;
  photoUrl?: string;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  mode: 'online' | 'offline';
  location?: string;
  onlineLink?: string;
  isPrivate?: boolean;
  isPaid?: boolean;
  price?: number;
  maxAttendees?: number;
  eligibilityMinAge?: number;
  eligibilityGender?: 'all' | 'male' | 'female';
  allowCloning?: boolean;
  adminApprovalNeeded?: boolean;
  rawMaterials?: string[];
}

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

export async function getEvent(id: number, viewerId?: number) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          profile: {
            select: {
              id: true,
              name: true,
              photoUrl: true,
              aboutMe: true,
              serviceTypes: { include: { subcategory: true }, take: 1 },
              address: { include: { area: { include: { city: true } } } },
            },
          },
        },
      },
      rawMaterials: true,
      ratings: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          user: { select: { id: true, userType: true, profile: { select: { name: true } } } },
        },
      },
      _count: { select: { attendees: { where: { status: 'joined' } } } },
    },
  });
  if (!event) throw ApiError.notFound('Event not found');

  const agg = await prisma.eventRating.aggregate({
    where: { eventId: id, rating: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  let myAttendance: { status: string; paymentStatus: string | null } | null = null;
  if (viewerId) {
    const a = await prisma.eventAttendee.findFirst({ where: { eventId: id, userId: viewerId } });
    if (a) myAttendance = { status: a.status, paymentStatus: a.paymentStatus };
  }

  return {
    ...event,
    ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
    ratingCount: agg._count.rating,
    myAttendance,
  };
}

// ── Events lifecycle (create / join / withdraw / pay / rate) ──

export async function createEvent(userId: number, data: CreateEventInput) {
  const event = await prisma.event.create({
    data: {
      creatorId: userId,
      title: data.title,
      description: data.description,
      photoUrl: data.photoUrl,
      date: parseDate(data.date) ?? new Date(),
      startTime: parseDate(data.startTime),
      durationMinutes: data.durationMinutes,
      mode: data.mode,
      location: data.location,
      onlineLink: data.onlineLink,
      isPrivate: data.isPrivate ?? false,
      isPaid: data.isPaid ?? false,
      price: data.price,
      maxAttendees: data.maxAttendees,
      eligibilityMinAge: data.eligibilityMinAge,
      eligibilityGender: data.eligibilityGender,
      allowCloning: data.allowCloning ?? false,
      adminApprovalNeeded: data.adminApprovalNeeded ?? false,
      rawMaterials: data.rawMaterials?.length
        ? { create: data.rawMaterials.map((material) => ({ material })) }
        : undefined,
    },
    include: eventCardInclude,
  });
  await bumpUserStats(userId, { eventsHosted: 1 });
  return event;
}

export async function updateEvent(eventId: number, userId: number, data: Partial<CreateEventInput>) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { creatorId: true } });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.creatorId !== userId) throw ApiError.forbidden('Only the host can edit this event');

  return prisma.event.update({
    where: { id: eventId },
    data: {
      title: data.title,
      description: data.description,
      photoUrl: data.photoUrl,
      date: data.date ? parseDate(data.date) ?? undefined : undefined,
      startTime: data.startTime !== undefined ? parseDate(data.startTime) : undefined,
      durationMinutes: data.durationMinutes,
      mode: data.mode,
      location: data.location,
      onlineLink: data.onlineLink,
      isPrivate: data.isPrivate,
      isPaid: data.isPaid,
      price: data.price,
      maxAttendees: data.maxAttendees,
      eligibilityGender: data.eligibilityGender,
      eligibilityMinAge: data.eligibilityMinAge,
    },
    include: eventCardInclude,
  });
}

export async function joinEvent(eventId: number, userId: number) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { _count: { select: { attendees: { where: { status: 'joined' } } } } },
  });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.creatorId === userId) throw ApiError.badRequest('You are hosting this event');

  const existing = await prisma.eventAttendee.findFirst({ where: { eventId, userId } });
  if (existing?.status === 'joined') return existing;

  if (event.maxAttendees && event._count.attendees >= event.maxAttendees) {
    throw ApiError.badRequest('This event is full');
  }

  const status = event.adminApprovalNeeded ? 'pending_approval' : 'joined';
  const paymentStatus = event.isPaid ? 'unpaid' : null;

  const attendee = existing
    ? await prisma.eventAttendee.update({ where: { id: existing.id }, data: { status, paymentStatus } })
    : await prisma.eventAttendee.create({ data: { eventId, userId, status, paymentStatus } });

  await emitNotification({
    userId: event.creatorId,
    title: 'New attendee',
    body: `Someone joined "${event.title}"`,
    type: 'event_invite',
    entityType: 'event',
    entityId: eventId,
  });
  return attendee;
}

export async function withdrawEvent(eventId: number, userId: number) {
  const existing = await prisma.eventAttendee.findFirst({ where: { eventId, userId } });
  if (!existing) throw ApiError.badRequest('You have not joined this event');
  return prisma.eventAttendee.update({ where: { id: existing.id }, data: { status: 'withdrawn' } });
}

export async function payForEvent(eventId: number, userId: number, couponCode?: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw ApiError.notFound('Event not found');
  if (!event.isPaid) throw ApiError.badRequest('This event is free');

  const base = Number(event.price ?? 0);
  const coupon = await resolveCoupon(couponCode, base);
  const discount = coupon?.discount ?? 0;
  const amount = Math.max(base - discount, 0);

  const charge = mockCharge(amount); // MOCK gateway
  const payment = await prisma.eventPayment.create({
    data: {
      eventId,
      userId,
      amount,
      couponId: coupon?.couponId,
      discountApplied: discount,
      paymentStatus: 'paid',
      transactionRef: charge.transactionRef,
      paidAt: charge.paidAt,
    },
  });
  if (coupon) await redeemCoupon(coupon.couponId, userId, 'event', payment.id);

  // ensure the attendee row is joined + paid
  const existing = await prisma.eventAttendee.findFirst({ where: { eventId, userId } });
  if (existing) {
    await prisma.eventAttendee.update({
      where: { id: existing.id },
      data: { status: 'joined', paymentStatus: 'paid' },
    });
  } else {
    await prisma.eventAttendee.create({
      data: { eventId, userId, status: 'joined', paymentStatus: 'paid' },
    });
  }
  return payment;
}

export async function rateEvent(
  eventId: number,
  userId: number,
  data: { rating: number; review?: string },
) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw ApiError.notFound('Event not found');

  const existing = await prisma.eventRating.findFirst({ where: { eventId, userId } });
  if (existing) {
    return prisma.eventRating.update({
      where: { id: existing.id },
      data: { rating: data.rating, review: data.review ?? null },
    });
  }
  return prisma.eventRating.create({
    data: { eventId, userId, rating: data.rating, review: data.review ?? null },
  });
}

export async function requestEventDeletion(eventId: number, userId: number, reason?: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { creatorId: true } });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.creatorId !== userId) throw ApiError.forbidden('Only the host can request deletion');
  return prisma.eventDeletionRequest.create({
    data: { eventId, requestedBy: userId, reason, status: 'pending' },
  });
}

export async function myEvents(userId: number) {
  const [hosted, attending] = await Promise.all([
    prisma.event.findMany({
      where: { creatorId: userId, isActive: true },
      orderBy: { date: 'desc' },
      include: eventCardInclude,
    }),
    prisma.event.findMany({
      where: { isActive: true, attendees: { some: { userId, status: 'joined' } } },
      orderBy: { date: 'desc' },
      include: eventCardInclude,
    }),
  ]);
  return { hosted, attending };
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

const groupCardInclude = {
  creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  _count: { select: { members: true } },
};

export interface CreateGroupInput {
  title: string;
  description?: string;
  photoUrl?: string;
  durationDays?: number;
  isPrivate?: boolean;
  isPaid?: boolean;
  price?: number;
  maxMembers?: number;
  eligibilityMinAge?: number;
  eligibilityGender?: 'all' | 'male' | 'female';
  adminApprovalNeeded?: boolean;
  multipleAdminsAllowed?: boolean;
}

export async function getGroup(id: number, viewerId?: number) {
  const group = await prisma.interestGroup.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
      posts: {
        orderBy: { id: 'desc' },
        take: 10,
        include: {
          post: {
            include: {
              user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
              media: { take: 1, orderBy: { sortOrder: 'asc' } },
              _count: { select: { likes: true, comments: true } },
            },
          },
        },
      },
      _count: { select: { members: { where: { status: 'joined' } } } },
    },
  });
  if (!group) throw ApiError.notFound('Group not found');

  const agg = await prisma.interestGroupRating.aggregate({
    where: { groupId: id },
    _avg: { rating: true },
    _count: { rating: true },
  });

  let myMembership: { status: string; paymentStatus: string | null } | null = null;
  let isCreator = false;
  if (viewerId) {
    isCreator = group.creatorId === viewerId;
    const m = await prisma.interestGroupMember.findFirst({ where: { groupId: id, userId: viewerId } });
    if (m) myMembership = { status: m.status, paymentStatus: m.paymentStatus };
  }

  const { posts, ...rest } = group;
  return {
    ...rest,
    discussions: posts.map((gp) => gp.post),
    ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
    ratingCount: agg._count.rating,
    myMembership,
    isCreator,
  };
}

// ── Groups lifecycle (create / join / leave / pay / rate / post) ──

export async function createGroup(userId: number, data: CreateGroupInput) {
  const group = await prisma.interestGroup.create({
    data: {
      creatorId: userId,
      title: data.title,
      description: data.description,
      photoUrl: data.photoUrl,
      durationDays: data.durationDays,
      isPrivate: data.isPrivate ?? false,
      isPaid: data.isPaid ?? false,
      price: data.price,
      maxMembers: data.maxMembers,
      eligibilityMinAge: data.eligibilityMinAge,
      eligibilityGender: data.eligibilityGender,
      adminApprovalNeeded: data.adminApprovalNeeded ?? false,
      multipleAdminsAllowed: data.multipleAdminsAllowed ?? false,
      admins: { create: { userId, isCreator: true } },
      members: { create: { userId, status: 'joined' } },
    },
    include: groupCardInclude,
  });
  await bumpUserStats(userId, { groupsPartOf: 1 });
  return group;
}

export async function updateGroup(groupId: number, userId: number, data: Partial<CreateGroupInput>) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId !== userId) throw ApiError.forbidden('Only the creator can edit this group');
  return prisma.interestGroup.update({
    where: { id: groupId },
    data: {
      title: data.title,
      description: data.description,
      photoUrl: data.photoUrl,
      durationDays: data.durationDays,
      isPrivate: data.isPrivate,
      isPaid: data.isPaid,
      price: data.price,
      maxMembers: data.maxMembers,
      eligibilityGender: data.eligibilityGender,
      eligibilityMinAge: data.eligibilityMinAge,
    },
    include: groupCardInclude,
  });
}

export async function joinGroup(groupId: number, userId: number) {
  const group = await prisma.interestGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: { where: { status: 'joined' } } } } },
  });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId === userId) throw ApiError.badRequest('You created this group');

  const existing = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (existing?.status === 'joined') return existing;
  if (group.maxMembers && group._count.members >= group.maxMembers) {
    throw ApiError.badRequest('This group is full');
  }

  const status = group.adminApprovalNeeded ? 'pending_approval' : 'joined';
  const paymentStatus = group.isPaid ? 'unpaid' : null;
  const member = existing
    ? await prisma.interestGroupMember.update({ where: { id: existing.id }, data: { status, paymentStatus } })
    : await prisma.interestGroupMember.create({ data: { groupId, userId, status, paymentStatus } });

  if (status === 'joined') await bumpUserStats(userId, { groupsPartOf: 1 });
  await emitNotification({
    userId: group.creatorId,
    title: 'New member',
    body: `Someone joined "${group.title}"`,
    type: 'group_invite',
    entityType: 'group',
    entityId: groupId,
  });
  return member;
}

export async function leaveGroup(groupId: number, userId: number) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId === userId) throw ApiError.badRequest('The creator cannot exit the group');
  const existing = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (!existing) throw ApiError.badRequest('You are not a member');
  return prisma.interestGroupMember.update({ where: { id: existing.id }, data: { status: 'exited' } });
}

export async function payForGroup(groupId: number, userId: number, couponCode?: string) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId } });
  if (!group) throw ApiError.notFound('Group not found');
  if (!group.isPaid) throw ApiError.badRequest('This group is free');

  const base = Number(group.price ?? 0);
  const coupon = await resolveCoupon(couponCode, base);
  const discount = coupon?.discount ?? 0;
  const amount = Math.max(base - discount, 0);

  const charge = mockCharge(amount); // MOCK gateway
  const payment = await prisma.interestGroupPayment.create({
    data: {
      groupId,
      userId,
      amount,
      couponId: coupon?.couponId,
      discountApplied: discount,
      paymentStatus: 'paid',
      transactionRef: charge.transactionRef,
      paidAt: charge.paidAt,
    },
  });
  if (coupon) await redeemCoupon(coupon.couponId, userId, 'group', payment.id);

  const existing = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (existing) {
    await prisma.interestGroupMember.update({
      where: { id: existing.id },
      data: { status: 'joined', paymentStatus: 'paid' },
    });
  } else {
    await prisma.interestGroupMember.create({
      data: { groupId, userId, status: 'joined', paymentStatus: 'paid' },
    });
  }
  return payment;
}

export async function rateGroup(
  groupId: number,
  userId: number,
  data: { rating: number; review?: string },
) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw ApiError.notFound('Group not found');
  const existing = await prisma.interestGroupRating.findFirst({ where: { groupId, userId } });
  if (existing) {
    return prisma.interestGroupRating.update({
      where: { id: existing.id },
      data: { rating: data.rating, review: data.review ?? null },
    });
  }
  return prisma.interestGroupRating.create({
    data: { groupId, userId, rating: data.rating, review: data.review ?? null },
  });
}

export async function createGroupPost(
  groupId: number,
  userId: number,
  data: { textContent?: string; media?: { mediaType: string; url: string }[] },
) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (!group) throw ApiError.notFound('Group not found');
  const member = await prisma.interestGroupMember.findFirst({
    where: { groupId, userId, status: 'joined' },
  });
  if (!member && group.creatorId !== userId) throw ApiError.forbidden('Only members can post');

  const post = await prisma.post.create({
    data: {
      userId,
      postType: 'share_update',
      textContent: data.textContent,
      media: data.media?.length
        ? { create: data.media.map((m, i) => ({ mediaType: m.mediaType, url: m.url, sortOrder: i })) }
        : undefined,
    },
  });
  await prisma.interestGroupPost.create({ data: { groupId, postId: post.id } });
  await bumpUserStats(userId, { postsMade: 1 });
  return post;
}

export async function myGroups(userId: number) {
  return prisma.interestGroup.findMany({
    where: {
      isActive: true,
      OR: [{ creatorId: userId }, { members: { some: { userId, status: 'joined' } } }],
    },
    orderBy: { createdAt: 'desc' },
    include: groupCardInclude,
  });
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
