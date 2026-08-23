import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

export async function blockUser(blockerId: number, blockedId: number, reason?: string) {
  if (blockerId === blockedId) throw ApiError.badRequest("You can't block yourself.");
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
  if (!target) throw ApiError.notFound('User not found');
  return prisma.blockedUser.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: { reason, blockScope: 'full' },
    create: { blockerId, blockedId, reason, blockScope: 'full' },
  });
}

export async function unblockUser(blockerId: number, blockedId: number) {
  await prisma.blockedUser.deleteMany({ where: { blockerId, blockedId } });
  return { blocked: false };
}

export async function blockStatus(blockerId: number, blockedId: number) {
  const row = await prisma.blockedUser.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  return { blocked: !!row };
}

/** People this user has blocked — for the Blocked Users screen. */
export async function listBlocked(blockerId: number) {
  const rows = await prisma.blockedUser.findMany({
    where: { blockerId },
    orderBy: { blockedAt: 'desc' },
    include: {
      blocked: {
        select: {
          id: true,
          userType: true,
          profile: {
            select: {
              name: true,
              photoUrl: true,
              professions: { take: 1, select: { companyOrDetail: true } },
              address: { select: { area: { select: { areaName: true, suburb: true } } } },
            },
          },
        },
      },
    },
  });

  return rows.map((r) => {
    const p = r.blocked.profile;
    const role = p?.professions[0]?.companyOrDetail || (r.blocked.userType === 'service_provider' ? 'Service Provider' : 'Resident');
    const location = p?.address?.area?.areaName || p?.address?.area?.suburb || null;
    return {
      userId: r.blocked.id,
      name: p?.name ?? 'Unknown',
      photoUrl: p?.photoUrl ?? null,
      role,
      location,
    };
  });
}
