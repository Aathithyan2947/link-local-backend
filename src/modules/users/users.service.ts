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
