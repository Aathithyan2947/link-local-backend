import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

/** The current user's notifications, newest first. */
export async function listNotifications(userId: number, take = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function unreadCount(userId: number) {
  const count = await prisma.notification.count({ where: { userId, isRead: false } });
  return { count };
}

export async function markRead(userId: number, id: number) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.userId !== userId) throw ApiError.notFound('Notification not found');
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}

export async function markAllRead(userId: number) {
  const res = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
  return { updated: res.count };
}
