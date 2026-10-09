import { prisma } from '../../lib/prisma.js';
import { assertProfileVisible, visibleProfileWhere } from '../../lib/profileVisibility.js';
import { providerLocationInclude, viewerCoords, withPublicLocation } from '../../lib/providerLocation.js';
import { hasEventStarted, withViewerEventState } from '../../lib/eventTiming.js';
import { destroyByUrl } from '../../lib/cloudinary.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import {
  resolveUserScopeContext,
  sanitizeAreaOverride,
  addressScopeFilter,
  type HomeScope,
} from '../home/home.service.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';
import { mockCharge } from '../../lib/payments.js';
import { decorateDiscussions } from '../feed/feed.service.js';
import { resolveCoupon, redeemCoupon } from '../../lib/coupons.js';
import { computeOpenSlots } from '../../lib/slots.js';
import { resolveProviderKind, resolveProviderFeatures } from '../../lib/providerKind.js';
import { getCustomFieldsForProfile } from '../../lib/customFields.js';

/** Open, bookable slots for an SP (for the resident's schedule view + checkout). */
export async function getServiceProviderSlots(id: number, from?: string, days?: number) {
  return computeOpenSlots(id, from, days);
}

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
  latitude?: number | null;
  longitude?: number | null;
  googlePlaceId?: string | null;
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
export async function listEvents(
  userId: number,
  params: PaginationParams & { q?: string; scope?: HomeScope; areaId?: number },
) {
  const ctx = await resolveUserScopeContext(userId);
  const overrideAreaId = await sanitizeAreaOverride(params.areaId, ctx.cityId);
  const addressFilter = addressScopeFilter(params.scope ?? 'city', ctx, overrideAreaId);
  const hasFilter = Object.keys(addressFilter).length > 0;
  const where: Record<string, unknown> = {
    isActive: true,
    ...(hasFilter ? { creator: { profile: { address: addressFilter } } } : {}),
  };
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
  const [ratings, withState] = await Promise.all([
    eventRatingMap(items.map((e) => e.id)),
    withViewerEventState(items, userId),
  ]);
  const enriched = withState.map((e) => ({
    ...e,
    ratingAvg: ratings.get(e.id)?.avg ?? null,
    ratingCount: ratings.get(e.id)?.count ?? 0,
  }));
  return { items: enriched, meta: buildMeta(params.page, params.pageSize, total) };
}

/**
 * Who may review an event: someone who joined it, once it has started — never its host.
 * Returns null when allowed, else the reason (what the API reports).
 */
function eventReviewBlocker(
  event: { creatorId: number; date: Date; startTime: Date | null },
  userId: number,
  attendance: { status: string } | null,
): string | null {
  if (event.creatorId === userId) return "You can't review your own event";
  if (attendance?.status !== 'joined') return 'Only people who joined this event can review it';
  if (!hasEventStarted(event)) return 'You can review this event after it starts';
  return null;
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

  const isHost = viewerId != null && event.creatorId === viewerId;
  return {
    ...event,
    ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
    ratingCount: agg._count.rating,
    myAttendance,
    // Decided here so the app never needs its own copy of the review rules.
    isHost,
    hasStarted: hasEventStarted(event),
    canReview: viewerId != null && eventReviewBlocker(event, viewerId, myAttendance) === null,
    canJoin: !isHost && !hasEventStarted(event) && myAttendance?.status !== 'joined',
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
      latitude: data.latitude,
      longitude: data.longitude,
      googlePlaceId: data.googlePlaceId,
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
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { creatorId: true, photoUrl: true } });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.creatorId !== userId) throw ApiError.forbidden('Only the host can edit this event');

  const updated = await prisma.event.update({
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
      latitude: data.latitude,
      longitude: data.longitude,
      googlePlaceId: data.googlePlaceId,
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
  if (data.photoUrl !== undefined && data.photoUrl !== event.photoUrl && event.photoUrl) {
    void destroyByUrl(event.photoUrl, 'image');
  }
  return updated;
}

/**
 * Checks a user may enter the event, returning it with their existing attendee row. Shared
 * by joining (free events) and paying (paid events) so both enforce the same rules.
 */
async function eventEntry(eventId: number, userId: number) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { _count: { select: { attendees: { where: { status: 'joined' } } } } },
  });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.creatorId === userId) throw ApiError.badRequest('You are hosting this event');
  const existing = await prisma.eventAttendee.findFirst({ where: { eventId, userId } });
  if (existing?.status === 'joined' || existing?.status === 'pending_approval') {
    return { event, existing, alreadyIn: true };
  }
  if (hasEventStarted(event)) throw ApiError.badRequest('This event has already started');
  if (event.maxAttendees && event._count.attendees >= event.maxAttendees) {
    throw ApiError.badRequest('This event is full');
  }
  return { event, existing, alreadyIn: false };
}

/** Adds (or re-adds) the attendee — awaiting approval when the host vets attendees. */
async function admitAttendee(
  event: { id: number; title: string; creatorId: number; adminApprovalNeeded: boolean },
  userId: number,
  existing: { id: number } | null,
  paymentStatus: string | null,
) {
  const status = event.adminApprovalNeeded ? 'pending_approval' : 'joined';
  const attendee = existing
    ? await prisma.eventAttendee.update({ where: { id: existing.id }, data: { status, paymentStatus } })
    : await prisma.eventAttendee.create({ data: { eventId: event.id, userId, status, paymentStatus } });
  await emitNotification({
    userId: event.creatorId,
    title: 'New attendee',
    body: `Someone joined "${event.title}"`,
    type: 'event_invite',
    entityType: 'event',
    entityId: event.id,
  });
  return attendee;
}

/** Joins a free event. A paid event is joined only by paying (`payForEvent`). */
export async function joinEvent(eventId: number, userId: number) {
  const { event, existing, alreadyIn } = await eventEntry(eventId, userId);
  if (alreadyIn) return existing!;
  // Someone who paid and later withdrew rejoins without paying again.
  if (event.isPaid && existing?.paymentStatus !== 'paid') {
    throw new ApiError(402, 'Payment required to join this event', { amount: Number(event.price ?? 0) });
  }
  return admitAttendee(event, userId, existing, event.isPaid ? 'paid' : null);
}

export async function withdrawEvent(eventId: number, userId: number) {
  const existing = await prisma.eventAttendee.findFirst({ where: { eventId, userId } });
  if (!existing) throw ApiError.badRequest('You have not joined this event');
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true, startTime: true } });
  if (event && hasEventStarted(event)) throw ApiError.badRequest("You can't withdraw once the event has started");
  return prisma.eventAttendee.update({ where: { id: existing.id }, data: { status: 'withdrawn' } });
}

/** Pays for a paid event; the user becomes an attendee only once the charge succeeds. */
export async function payForEvent(eventId: number, userId: number, couponCode?: string) {
  const { event, existing, alreadyIn } = await eventEntry(eventId, userId);
  if (!event.isPaid) throw ApiError.badRequest('This event is free');
  if (existing?.paymentStatus === 'paid') {
    throw ApiError.conflict(alreadyIn ? 'You have already paid for this event' : 'Already paid — join again for free');
  }

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

  if (alreadyIn) {
    // Joined before payment was enforced: keep their place, now paid.
    await prisma.eventAttendee.update({ where: { id: existing!.id }, data: { paymentStatus: 'paid' } });
  } else {
    await admitAttendee(event, userId, existing, 'paid');
  }
  return payment;
}

export async function rateEvent(
  eventId: number,
  userId: number,
  data: { rating: number; review?: string },
) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, creatorId: true, date: true, startTime: true },
  });
  if (!event) throw ApiError.notFound('Event not found');
  const attendance = await prisma.eventAttendee.findFirst({ where: { eventId, userId }, select: { status: true } });
  const blocker = eventReviewBlocker(event, userId, attendance);
  if (blocker) throw event.creatorId === userId ? ApiError.forbidden(blocker) : ApiError.badRequest(blocker);

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
  const ratings = await eventRatingMap([...hosted, ...attending].map((e) => e.id));
  const enrich = async (items: typeof hosted) =>
    (await withViewerEventState(items, userId)).map((e) => ({
      ...e,
      ratingAvg: ratings.get(e.id)?.avg ?? null,
      ratingCount: ratings.get(e.id)?.count ?? 0,
    }));
  const [hostedOut, attendingOut] = await Promise.all([enrich(hosted), enrich(attending)]);
  return { hosted: hostedOut, attending: attendingOut };
}

// ── Interest Groups ──────────────────────────────────────────
export async function listGroups(
  userId: number,
  params: PaginationParams & { q?: string; scope?: HomeScope; areaId?: number; excludeMine?: boolean },
) {
  const ctx = await resolveUserScopeContext(userId);
  const overrideAreaId = await sanitizeAreaOverride(params.areaId, ctx.cityId);
  const addressFilter = addressScopeFilter(params.scope ?? 'city', ctx, overrideAreaId);
  const hasFilter = Object.keys(addressFilter).length > 0;
  const where: Record<string, unknown> = {
    isActive: true,
    ...(hasFilter ? { creator: { profile: { address: addressFilter } } } : {}),
  };
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };
  // Groups to discover only: not the caller's own, nor ones they're in or waiting to join.
  if (params.excludeMine) {
    where.creatorId = { not: userId };
    where.members = { none: { userId, status: { in: ['joined', 'pending_approval'] } } };
  }

  const [items, total] = await Promise.all([
    prisma.interestGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Same card shape as My Groups: the member count is people who have joined (not those
      // who left or are still waiting).
      include: groupCardInclude,
      ...toPrismaPagination(params),
    }),
    prisma.interestGroup.count({ where }),
  ]);
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

const groupCardInclude = {
  creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  _count: { select: { members: { where: { status: 'joined' } } } },
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
      creator: {
        select: {
          id: true,
          profile: {
            select: {
              name: true,
              photoUrl: true,
              address: { select: { area: { select: { areaName: true } } } },
            },
          },
        },
      },
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

  let myMembership: { status: string; paymentStatus: string | null; muted: boolean } | null = null;
  let isCreator = false;
  let clearedAt: Date | null = null;
  if (viewerId) {
    isCreator = group.creatorId === viewerId;
    const m = await prisma.interestGroupMember.findFirst({ where: { groupId: id, userId: viewerId } });
    if (m) {
      myMembership = { status: m.status, paymentStatus: m.paymentStatus, muted: m.muted };
      clearedAt = m.chatClearedAt;
    }
  }

  const { posts, ...rest } = group;
  // Whoever created the group anchors it to a place; that is what the discussions header names.
  const area = group.creator.profile?.address?.area?.areaName ?? null;
  const visible = posts
    .map((gp) => gp.post)
    // "Clear chat" hides history for the member who asked, not for the group.
    .filter((post) => clearedAt === null || post.createdAt > clearedAt);
  const discussions = viewerId ? await decorateDiscussions(visible, viewerId) : visible;

  return {
    ...rest,
    area,
    discussions,
    ratingAvg: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
    ratingCount: agg._count.rating,
    myMembership,
    isCreator,
  };
}

/** The group's discussions, optionally narrowed to posts by members living in one area —
 *  the same per-section area scoping Home applies to its own Community Discussions. Kept
 *  separate from `getGroup` so changing the area refetches a list, not the whole profile. */
export async function listGroupDiscussions(groupId: number, viewerId: number, areaId?: number) {
  const member = await prisma.interestGroupMember.findFirst({
    where: { groupId, userId: viewerId },
    select: { chatClearedAt: true },
  });
  const clearedAt = member?.chatClearedAt ?? null;

  const ctx = await resolveUserScopeContext(viewerId);
  const safeAreaId = await sanitizeAreaOverride(areaId, ctx.cityId);

  const rows = await prisma.interestGroupPost.findMany({
    where: {
      groupId,
      ...(safeAreaId ? { post: { user: { profile: { address: { areaId: safeAreaId } } } } } : {}),
    },
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
  });

  return decorateDiscussions(
    rows.map((gp) => gp.post).filter((post) => clearedAt === null || post.createdAt > clearedAt),
    viewerId,
  );
}

/** Joined members of a group, for the Members action on the group profile. */
export async function listGroupMembers(groupId: number) {
  const rows = await prisma.interestGroupMember.findMany({
    where: { groupId, status: 'joined' },
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } } },
  });
  const group = await prisma.interestGroup.findUnique({
    where: { id: groupId },
    select: { creatorId: true },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.profile?.name ?? 'Member',
    photoUrl: m.user.profile?.photoUrl ?? null,
    isCreator: m.user.id === group?.creatorId,
    joinedAt: m.joinedAt,
  }));
}

/** Per-member notification mute for one group. */
export async function setGroupMuted(groupId: number, userId: number, muted: boolean) {
  const member = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (!member) throw ApiError.forbidden('Join the group first');
  await prisma.interestGroupMember.update({ where: { id: member.id }, data: { muted } });
  return { muted };
}

/** Hides the group's existing discussions from this member only. */
export async function clearGroupChat(groupId: number, userId: number) {
  const member = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (!member) throw ApiError.forbidden('Join the group first');
  await prisma.interestGroupMember.update({
    where: { id: member.id },
    data: { chatClearedAt: new Date() },
  });
  return { cleared: true };
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
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { creatorId: true, photoUrl: true } });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId !== userId) throw ApiError.forbidden('Only the creator can edit this group');
  const updated = await prisma.interestGroup.update({
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
  if (data.photoUrl !== undefined && data.photoUrl !== group.photoUrl && group.photoUrl) {
    void destroyByUrl(group.photoUrl, 'image');
  }
  return updated;
}

/**
 * Checks a user may enter the group, returning it with their existing membership. Shared by
 * joining (free groups) and paying (paid groups) so both enforce the same rules.
 */
async function groupEntry(groupId: number, userId: number) {
  const group = await prisma.interestGroup.findUnique({
    where: { id: groupId },
    include: { _count: { select: { members: { where: { status: 'joined' } } } } },
  });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId === userId) throw ApiError.badRequest('You created this group');
  const existing = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (existing?.status === 'joined' || existing?.status === 'pending_approval') {
    return { group, existing, alreadyIn: true };
  }
  if (group.maxMembers && group._count.members >= group.maxMembers) {
    throw ApiError.badRequest('This group is full');
  }
  return { group, existing, alreadyIn: false };
}

/** Adds (or re-adds) the member — awaiting approval when the group vets members. */
async function admitMember(
  group: { id: number; title: string; creatorId: number; adminApprovalNeeded: boolean },
  userId: number,
  existing: { id: number } | null,
  paymentStatus: string | null,
) {
  const status = group.adminApprovalNeeded ? 'pending_approval' : 'joined';
  const member = existing
    ? await prisma.interestGroupMember.update({ where: { id: existing.id }, data: { status, paymentStatus } })
    : await prisma.interestGroupMember.create({ data: { groupId: group.id, userId, status, paymentStatus } });

  if (status === 'joined') await bumpUserStats(userId, { groupsPartOf: 1 });
  const creatorMembership = await prisma.interestGroupMember.findFirst({
    where: { groupId: group.id, userId: group.creatorId },
    select: { muted: true },
  });
  if (!creatorMembership?.muted) {
    await emitNotification({
      userId: group.creatorId,
      title: 'New member',
      body: `Someone joined "${group.title}"`,
      type: 'group_invite',
      entityType: 'group',
      entityId: group.id,
    });
  }
  return member;
}

/** Joins a free group. A paid group is joined only by paying (`payForGroup`). */
export async function joinGroup(groupId: number, userId: number) {
  const { group, existing, alreadyIn } = await groupEntry(groupId, userId);
  if (alreadyIn) return existing!;
  // Someone who paid and later exited rejoins without paying again.
  if (group.isPaid && existing?.paymentStatus !== 'paid') {
    throw new ApiError(402, 'Payment required to join this group', { amount: Number(group.price ?? 0) });
  }
  return admitMember(group, userId, existing, group.isPaid ? 'paid' : null);
}

export async function leaveGroup(groupId: number, userId: number) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { creatorId: true } });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId === userId) throw ApiError.badRequest('The creator cannot exit the group');
  const existing = await prisma.interestGroupMember.findFirst({ where: { groupId, userId } });
  if (!existing) throw ApiError.badRequest('You are not a member');
  return prisma.interestGroupMember.update({ where: { id: existing.id }, data: { status: 'exited' } });
}

/** Pays for a paid group; the user becomes a member only once the charge succeeds. */
export async function payForGroup(groupId: number, userId: number, couponCode?: string) {
  const { group, existing, alreadyIn } = await groupEntry(groupId, userId);
  if (!group.isPaid) throw ApiError.badRequest('This group is free');
  if (existing?.paymentStatus === 'paid') {
    throw ApiError.conflict(alreadyIn ? 'You have already paid for this group' : 'Already paid — join again for free');
  }

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

  if (alreadyIn) {
    // Joined before payment was enforced: keep their place, now paid.
    await prisma.interestGroupMember.update({ where: { id: existing!.id }, data: { paymentStatus: 'paid' } });
  } else {
    await admitMember(group, userId, existing, 'paid');
  }
  return payment;
}

export async function rateGroup(
  groupId: number,
  userId: number,
  data: { rating: number; review?: string },
) {
  const group = await prisma.interestGroup.findUnique({ where: { id: groupId }, select: { id: true, creatorId: true } });
  if (!group) throw ApiError.notFound('Group not found');
  if (group.creatorId === userId) throw ApiError.forbidden("You can't review your own group");
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
  const [owned, joined] = await Promise.all([
    prisma.interestGroup.findMany({
      where: { creatorId: userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: groupCardInclude,
    }),
    // Groups the member joined. Their own groups list them as a member too, but those belong
    // under "Your Groups" only.
    prisma.interestGroup.findMany({
      where: { isActive: true, creatorId: { not: userId }, members: { some: { userId, status: 'joined' } } },
      orderBy: { createdAt: 'desc' },
      include: groupCardInclude,
    }),
  ]);
  return { owned, joined };
}

// ── Service Providers ────────────────────────────────────────
export async function listServiceProviders(
  userId: number,
  params: PaginationParams & { q?: string; subcategoryId?: number; scope?: HomeScope; areaId?: number },
) {
  const ctx = await resolveUserScopeContext(userId);
  const overrideAreaId = await sanitizeAreaOverride(params.areaId, ctx.cityId);
  const addressFilter = addressScopeFilter(params.scope ?? 'city', ctx, overrideAreaId);
  const hasFilter = Object.keys(addressFilter).length > 0;
  const where: Record<string, unknown> = {
    // Not the viewer themselves (as on Home), so both screens count the same providers.
    user: { id: { not: userId }, userType: 'service_provider', isActive: true },
    // Only providers whose Profile visibility lets this viewer see them.
    AND: [visibleProfileWhere(ctx)],
  };
  if (hasFilter) where.address = addressFilter;
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
        ...providerLocationInclude,
      },
      ...toPrismaPagination(params),
    }),
    prisma.profile.count({ where }),
  ]);
  const [ratings, viewer] = await Promise.all([spRatingMap(items.map((p) => p.id)), viewerCoords(userId)]);
  const enriched = items.map((p) => ({
    ...withPublicLocation(p, viewer),
    ratingAvg: ratings.get(p.id)?.avg ?? null,
    ratingCount: ratings.get(p.id)?.count ?? p._count.ratings,
  }));
  return { items: enriched, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getServiceProvider(id: number, callerId?: number) {
  const sp = await prisma.profile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, userType: true, mobile: true, email: true } },
      address: { include: { area: { include: { city: true } } } },
      educations: true,
      professions: { include: { professionMaster: true } },
      serviceTypes: {
        include: {
          subcategory: {
            include: {
              category: true,
              fields: { where: { isActive: true }, select: { fieldType: true } },
            },
          },
        },
      },
      products: {
        where: { isAvailable: true },
        orderBy: { sortOrder: 'asc' },
        include: { customizations: { orderBy: { sortOrder: 'asc' } } },
      },
      rates: { where: { isActive: true }, orderBy: { id: 'asc' } },
      media: { orderBy: { sortOrder: 'asc' } },
      delivery: true,
      availability: true,
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
  // Their Profile visibility setting decides who may open this page.
  await assertProfileVisible(
    { userId: sp.userId, profileId: sp.id, address: sp.address ? { areaId: sp.address.areaId, apartment: sp.address.apartment } : null },
    callerId,
  );

  const userId = sp.userId;
  const eventInclude = {
    creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
    _count: { select: { attendees: true } },
  };
  // A provider's profile shows only the events they created — joining someone else's
  // event must not put it on their page. A resident's (own) profile keeps both.
  const isProvider = sp.user.userType === 'service_provider';
  // Private events appear on a profile only for the host and the people they invited.
  const visibleToCaller =
    callerId === userId
      ? {}
      : {
          OR: [
            { isPrivate: false },
            ...(callerId != null ? [{ invitedUsers: { some: { invitedUserId: callerId } } }] : []),
          ],
        };

  const [ragg, hosted, attending, posts, adminGroups, memberGroups, customFields, privacy] = await Promise.all([
    prisma.serviceProviderRating.aggregate({
      where: { profileId: id },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.event.findMany({
      where: { creatorId: userId, isActive: true, ...visibleToCaller },
      orderBy: { date: 'desc' },
      take: 10,
      include: eventInclude,
    }),
    isProvider
      ? Promise.resolve([])
      : prisma.event.findMany({
          where: { isActive: true, attendees: { some: { userId, status: 'joined' } }, ...visibleToCaller },
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
    getCustomFieldsForProfile(id, { onlyAnswered: true }),
    prisma.profilePrivacySetting.findUnique({ where: { profileId: id }, select: { showCallButton: true } }),
  ]);

  // Tag + dedupe events (hosting wins over attending) and attach rating averages.
  const hostedIds = new Set(hosted.map((e) => e.id));
  const eventRows = [
    ...hosted.map((e) => ({ ...e, relation: 'hosting' as const })),
    ...attending.filter((e) => !hostedIds.has(e.id)).map((e) => ({ ...e, relation: 'attending' as const })),
  ];
  const [eventRatings, eventRowsWithState] = await Promise.all([
    eventRatingMap(eventRows.map((e) => e.id)),
    callerId != null ? withViewerEventState(eventRows, callerId) : eventRows,
  ]);
  const events = eventRowsWithState.map((e) => ({ ...e, ratingAvg: eventRatings.get(e.id)?.avg ?? null }));

  // Tag + dedupe interest groups (admin wins over member).
  const adminGroupIds = new Set(adminGroups.map((a) => a.groupId));
  const groups = [
    ...adminGroups.map((a) => ({ ...a.group, role: 'admin' as const })),
    ...memberGroups
      .filter((m) => !adminGroupIds.has(m.groupId))
      .map((m) => ({ ...m.group, role: 'member' as const })),
  ];

  const { hasMenu, hasDateBooking } = await resolveProviderFeatures(id);
  const showCallButton = privacy?.showCallButton ?? false;
  const isOwner = callerId != null && callerId === sp.userId;
  const mobileVisible = isOwner || showCallButton;

  let isBlocked = false;
  if (callerId != null && !isOwner) {
    const block = await prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: callerId, blockedId: sp.userId } },
    });
    isBlocked = !!block;
  }

  // The published number is the SP's service phone when they've set one, falling back to their
  // sign-in number only if they haven't. Once a service phone exists the credential is never
  // sent to anyone but the owner — publishing a business number must not expose the private
  // one behind it. (An SP is free to make them the same value; that's their choice, not ours.)
  const publishedPhone = sp.servicePhone?.trim() || sp.user.mobile;
  const publishedEmail = sp.serviceEmail?.trim() || null;

  return {
    ...sp,
    servicePhone: isOwner ? sp.servicePhone : null,
    serviceEmail: isOwner ? sp.serviceEmail : null,
    publishedPhone: mobileVisible ? publishedPhone : null,
    publishedEmail,
    user: {
      ...sp.user,
      mobile: isOwner ? sp.user.mobile : null,
      email: isOwner ? sp.user.email : null,
    },
    providerKind: await resolveProviderKind(id),
    hasMenu,
    hasDateBooking,
    showCallButton,
    isBlocked,
    customFields,
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

/** Every review the current user has submitted, across the three entities that support one. */
export async function myReviews(userId: number) {
  const [serviceProviders, events, groups] = await Promise.all([
    prisma.serviceProviderRating.findMany({
      where: { ratedBy: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        profile: {
          select: {
            id: true,
            name: true,
            photoUrl: true,
            address: { select: { fullAddress: true } },
            serviceTypes: { include: { subcategory: true }, take: 1 },
          },
        },
      },
    }),
    prisma.eventRating.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            photoUrl: true,
            creator: { select: { profile: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.interestGroupRating.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        group: {
          select: {
            id: true,
            title: true,
            photoUrl: true,
            creator: { select: { profile: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);
  return { serviceProviders, events, groups };
}
