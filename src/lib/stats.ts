import { prisma } from './prisma.js';
import { logger } from './logger.js';

/** Numeric counters on user_stats that can be incremented/decremented. */
export type UserStatCounter =
  | 'servicesAvailed'
  | 'messagesSent'
  | 'repliesPending'
  | 'postsMade'
  | 'eventsHosted'
  | 'groupsPartOf'
  | 'referralPointsBalance'
  | 'leadsReceived'
  | 'leadsRejected'
  | 'ordersReceived'
  | 'paymentReceivedTotal';

/**
 * Atomically increments (or decrements, with a negative delta) user_stats
 * counters, creating the row on first use. Never throws — stats are best-effort.
 *
 *   await bumpUserStats(userId, { eventsHosted: 1 });
 *   await bumpUserStats(spUserId, { ordersReceived: 1, paymentReceivedTotal: 250 });
 */
export async function bumpUserStats(
  userId: number,
  deltas: Partial<Record<UserStatCounter, number>>,
): Promise<void> {
  try {
    const update = Object.fromEntries(
      Object.entries(deltas).map(([field, delta]) => [field, { increment: delta }]),
    );
    const create = { userId, ...deltas };
    await prisma.userStats.upsert({ where: { userId }, update, create });
  } catch (err) {
    logger.error({ err }, 'bumpUserStats failed');
  }
}
