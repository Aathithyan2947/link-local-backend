import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';

const person = { select: { id: true, profile: { select: { name: true, photoUrl: true } } } };

/** Stable conversation key for a pair of users (order-independent). */
function convId(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join('-');
}

export interface SendMessageInput {
  receiverId: number;
  content: string;
  messageType?: 'direct' | 'enquiry';
  entityType?: string;
  entityId?: number;
}

export async function sendMessage(senderId: number, data: SendMessageInput) {
  if (data.receiverId === senderId) throw ApiError.badRequest('You cannot message yourself');
  const receiver = await prisma.user.findUnique({ where: { id: data.receiverId }, select: { id: true } });
  if (!receiver) throw ApiError.notFound('Recipient not found');

  const message = await prisma.message.create({
    data: {
      senderId,
      receiverId: data.receiverId,
      messageType: data.messageType ?? 'direct',
      content: data.content,
      entityType: data.entityType,
      entityId: data.entityId,
      conversationId: convId(senderId, data.receiverId),
      enquiryStatus: data.messageType === 'enquiry' ? 'pending' : undefined,
    },
    include: { sender: person, receiver: person },
  });
  await bumpUserStats(senderId, { messagesSent: 1 });
  await emitNotification({
    userId: data.receiverId,
    title: data.messageType === 'enquiry' ? 'New enquiry' : 'New message',
    body: data.content.slice(0, 80),
    type: data.messageType === 'enquiry' ? 'enquiry' : 'message',
    entityType: 'message',
    entityId: senderId,
  });
  return message;
}

/** One row per conversation: the other person, last message, and unread count. */
export async function listConversations(userId: number) {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: 'desc' },
    include: { sender: person, receiver: person },
  });

  const map = new Map<
    string,
    { conversationId: string; other: (typeof messages)[number]['sender']; lastMessage: string; lastAt: Date; unread: number }
  >();
  for (const m of messages) {
    const key = m.conversationId ?? convId(m.senderId, m.receiverId);
    if (!map.has(key)) {
      const other = m.senderId === userId ? m.receiver : m.sender;
      map.set(key, { conversationId: key, other, lastMessage: m.content, lastAt: m.createdAt, unread: 0 });
    }
    if (m.receiverId === userId && !m.isRead) map.get(key)!.unread++;
  }
  return [...map.values()];
}

/** Full thread with another user; marks incoming messages as read. */
export async function getThread(userId: number, otherUserId: number) {
  const conversationId = convId(userId, otherUserId);
  const [other, messages] = await Promise.all([
    prisma.user.findUnique({ where: { id: otherUserId }, ...person }),
    prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!other) throw ApiError.notFound('User not found');
  await prisma.message.updateMany({
    where: { conversationId, receiverId: userId, isRead: false },
    data: { isRead: true },
  });
  return { other, messages };
}

export async function unreadCount(userId: number) {
  const count = await prisma.message.count({ where: { receiverId: userId, isRead: false } });
  return { count };
}
