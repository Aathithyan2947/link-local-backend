import { prisma } from '../../lib/prisma.js';

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

const cityWhere = (cityId: number | null) =>
  cityId
    ? { creator: { profile: { address: { area: { cityId } } } } }
    : {};

/** Aggregated payload powering the Home screen. */
export async function getHomeFeed(userId: number) {
  const cityId = await resolveUserCityId(userId);
  const city = cityId
    ? await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true, state: true } })
    : null;

  const postCityWhere = cityId
    ? { user: { profile: { address: { area: { cityId } } } } }
    : {};
  const spCityWhere = cityId ? { address: { area: { cityId } } } : {};

  const memberWhere = cityId ? { address: { area: { cityId } } } : {};

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
        where: { isActive: true, ...cityWhere(cityId) },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { _count: { select: { members: true } } },
      }),
      prisma.event.findMany({
        where: { isActive: true, ...cityWhere(cityId) },
        orderBy: { date: 'asc' },
        take: 6,
        include: { _count: { select: { attendees: true } } },
      }),
      prisma.profile.findMany({
        where: { user: { userType: 'service_provider', isActive: true }, ...spCityWhere },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          serviceTypes: { include: { subcategory: true }, take: 2 },
          _count: { select: { ratings: true } },
        },
      }),
      prisma.interestGroup.count({ where: { isActive: true, ...cityWhere(cityId) } }),
      prisma.event.count({ where: { isActive: true, ...cityWhere(cityId) } }),
      prisma.profile.count({ where: { user: { userType: 'service_provider', isActive: true }, ...spCityWhere } }),
      prisma.profile.count({ where: memberWhere }),
      prisma.userStats.findUnique({ where: { userId } }),
    ]);

  return {
    city,
    stats: { members: memberCount, serviceProviders: spCount, events: workshopCount },
    referral: {
      pointsPerReferral: 150,
      message: 'Earn ₹150 for every friend you refer',
      balance: stats?.referralPointsBalance ?? 0,
    },
    discussions,
    groups: { total: groupCount, items: groups },
    workshops: { total: workshopCount, items: workshops },
    serviceProviders: { total: spCount, items: serviceProviders },
  };
}
