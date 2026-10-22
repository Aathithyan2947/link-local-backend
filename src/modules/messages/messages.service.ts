import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';
import { assertCanSharePost, postPreviews } from '../feed/feed.service.js';

const person = { select: { id: true, profile: { select: { name: true, photoUrl: true } } } };

/** Stable conversation key for a pair of users (order-independent). */
function convId(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join('-');
}

/** Whether [me] has blocked [other], and whether [other] has blocked [me]. Any block row
 *  (whatever its scope) stops messaging both ways. */
export async function blockBetween(me: number, other: number) {
  const rows = await prisma.blockedUser.findMany({
    where: {
      OR: [
        { blockerId: me, blockedId: other },
        { blockerId: other, blockedId: me },
      ],
    },
    select: { blockerId: true },
  });
  return {
    blockedByMe: rows.some((r) => r.blockerId === me),
    blockedByThem: rows.some((r) => r.blockerId === other),
  };
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
  // Nothing is saved or notified across a block, in either direction. Being blocked isn't
  // revealed: that side just can't message.
  const block = await blockBetween(senderId, data.receiverId);
  if (block.blockedByMe) throw ApiError.forbidden("You've blocked this person. Unblock them to send messages.");
  if (block.blockedByThem) throw ApiError.forbidden("You can't message this person.");
  // A shared post must be a real post the sender may share.
  if (data.entityType === 'post') {
    if (!data.entityId) throw ApiError.badRequest('Which post?');
    await assertCanSharePost(data.entityId, senderId);
  }
  // A shared event must still be listed (BUG-100: events share into chats like posts).
  if (data.entityType === 'event') {
    if (!data.entityId) throw ApiError.badRequest('Which event?');
    const event = await prisma.event.findUnique({ where: { id: data.entityId }, select: { isActive: true } });
    if (!event?.isActive) throw ApiError.notFound('This event is no longer available');
  }

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
  // Say who it's from, so the inbox reads "New message from Asha" rather than a bare title.
  const from = message.sender.profile?.name?.trim();
  await emitNotification({
    userId: data.receiverId,
    title: `${data.messageType === 'enquiry' ? 'New enquiry' : 'New message'}${from ? ` from ${from}` : ''}`,
    body: data.content.slice(0, 80),
    type: data.messageType === 'enquiry' ? 'enquiry' : 'message',
    entityType: 'message',
    entityId: senderId,
  });
  return message;
}

/** One row per conversation: the other person, last message, unread count, and whether the
 *  member has blocked them (the history stays; the app marks the row). */
export async function listConversations(userId: number) {
  const [messages, blocks] = await Promise.all([
    prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: { sender: person, receiver: person },
    }),
    prisma.blockedUser.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
  ]);
  const blocked = new Set(blocks.map((b) => b.blockedId));

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
  return [...map.values()].map((c) => ({ ...c, blockedByMe: blocked.has(c.other.id) }));
}

/** Full thread with another user; marks incoming messages as read. The history stays readable
 *  across a block; the flags tell the app to replace the composer. */
export async function getThread(userId: number, otherUserId: number) {
  const conversationId = convId(userId, otherUserId);
  const [other, messages, block] = await Promise.all([
    prisma.user.findUnique({ where: { id: otherUserId }, ...person }),
    prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    blockBetween(userId, otherUserId),
  ]);
  if (!other) throw ApiError.notFound('User not found');
  await prisma.message.updateMany({
    where: { conversationId, receiverId: userId, isRead: false },
    data: { isRead: true },
  });
  // Shared posts and events come with what the chat shows of them, one query each.
  const idsOf = (type: string) => messages.filter((m) => m.entityType === type && m.entityId != null).map((m) => m.entityId!);
  const [posts, events] = await Promise.all([postPreviews(idsOf('post')), eventPreviews(idsOf('event'))]);
  const withPreviews = messages.map((m) => {
    if (m.entityId == null) return m;
    if (m.entityType === 'post') return { ...m, post: posts.get(m.entityId) ?? null };
    if (m.entityType === 'event') return { ...m, event: events.get(m.entityId) ?? null };
    return m;
  });
  return { other, messages: withPreviews, ...block };
}

/** What a chat shows of a shared event: enough for a card that opens it. A removed event stays
 *  in the map with `isActive: false`, so the chat can say it's gone. */
async function eventPreviews(eventIds: number[]) {
  if (eventIds.length === 0) return new Map<number, never>();
  const events = await prisma.event.findMany({
    where: { id: { in: [...new Set(eventIds)] } },
    select: {
      id: true,
      title: true,
      date: true,
      startTime: true,
      mode: true,
      location: true,
      photoUrl: true,
      isActive: true,
      creator: { select: { profile: { select: { name: true } } } },
    },
  });
  return new Map(
    events.map((e) => [
      e.id,
      {
        id: e.id,
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        mode: e.mode,
        location: e.location,
        photoUrl: e.photoUrl,
        isActive: e.isActive,
        hostName: e.creator.profile?.name ?? 'Member',
      },
    ]),
  );
}

export async function unreadCount(userId: number) {
  const count = await prisma.message.count({ where: { receiverId: userId, isRead: false } });
  return { count };
}
