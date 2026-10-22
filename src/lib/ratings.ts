import { prisma } from './prisma.js';

// Rating lookups shared by Discover and Home. They live here rather than in
// discovery.service so home.service can use them without another circular import.

/** Rounds an average to one decimal, or null when there are no ratings. */
export const round1 = (avg: number | null | undefined) =>
  avg == null ? null : Math.round(avg * 10) / 10;

/** Builds an { eventId → { avg, count } } lookup for event ratings. */
export async function eventRatingMap(eventIds: number[]) {
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
export async function spRatingMap(profileIds: number[]) {
  if (profileIds.length === 0) return new Map<number, { avg: number | null; count: number }>();
  const groups = await prisma.serviceProviderRating.groupBy({
    by: ['profileId'],
    where: { profileId: { in: profileIds } },
    _avg: { rating: true },
    _count: { rating: true },
  });
  return new Map(groups.map((g) => [g.profileId, { avg: round1(g._avg.rating), count: g._count.rating }]));
}
