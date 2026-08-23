import { prisma } from '../../lib/prisma.js';
import { bumpUserStats } from '../../lib/stats.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../utils/ApiError.js';

/** Points credited to the referrer once their invitee completes registration. */
export const POINTS_PER_REFERRAL = 150;

/** Max invites a single member can send per day. */
export const DAILY_REFERRAL_LIMIT = 500;

function todayDateOnly(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export async function myReferrals(userId: number) {
  const [user, invitedCount, registeredCount, stats, cap, referred] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.count({ where: { referrerId: userId, status: 'complete_registration' } }),
    prisma.userStats.findUnique({ where: { userId }, select: { referralPointsBalance: true } }),
    prisma.referralDailyCap.findUnique({ where: { userId_capDate: { userId, capDate: todayDateOnly() } } }),
    prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { id: 'desc' },
      include: { referredUser: { select: { profile: { select: { name: true } } } } },
    }),
  ]);

  return {
    inviteCode: user.referralCode,
    invitedCount,
    registeredCount,
    pointsBalance: stats?.referralPointsBalance ?? 0,
    dailyLimit: DAILY_REFERRAL_LIMIT,
    dailySent: cap?.referralsSent ?? 0,
    referred: referred.map((r) => ({
      name: r.referredName ?? r.referredUser?.profile?.name ?? 'Member',
      status: r.status,
      createdAt: r.createdAt,
      registeredAt: r.registeredAt,
    })),
  };
}

export async function sendInvite(
  userId: number,
  input: { name?: string; phone?: string; channel?: string },
) {
  const capDate = todayDateOnly();
  const cap = await prisma.referralDailyCap.findUnique({ where: { userId_capDate: { userId, capDate } } });
  if ((cap?.referralsSent ?? 0) >= DAILY_REFERRAL_LIMIT) {
    throw ApiError.badRequest(`You've reached today's referral limit of ${DAILY_REFERRAL_LIMIT}.`);
  }

  await prisma.referralDailyCap.upsert({
    where: { userId_capDate: { userId, capDate } },
    update: { referralsSent: { increment: 1 } },
    create: { userId, capDate, referralsSent: 1 },
  });

  return prisma.referral.create({
    data: {
      referrerId: userId,
      referredName: input.name,
      referredPhone: input.phone,
      sharingChannel: input.channel,
      status: 'sent',
    },
  });
}

/**
 * Called on successful registration when the new user came in via a referral code.
 * Matches a pending "sent" invite by phone if one exists (so a tracked invite flips
 * to Registered), otherwise records the registration directly so it's never missed
 * even if the invitee registered without going through the invite's own link/message.
 * Best-effort: referral crediting must never block registration.
 */
export async function creditReferralOnRegistration(
  referrerId: number,
  newUser: { id: number; mobile: string | null },
): Promise<void> {
  try {
    const pending = newUser.mobile
      ? await prisma.referral.findFirst({
          where: { referrerId, referredPhone: newUser.mobile, status: 'sent' },
          orderBy: { id: 'desc' },
        })
      : null;

    const now = new Date();
    if (pending) {
      await prisma.referral.update({
        where: { id: pending.id },
        data: {
          referredUserId: newUser.id,
          status: 'complete_registration',
          registeredAt: now,
          pointsCredited: POINTS_PER_REFERRAL,
          pointsCreditedAt: now,
        },
      });
    } else {
      await prisma.referral.create({
        data: {
          referrerId,
          referredUserId: newUser.id,
          status: 'complete_registration',
          registeredAt: now,
          pointsCredited: POINTS_PER_REFERRAL,
          pointsCreditedAt: now,
        },
      });
    }
    await bumpUserStats(referrerId, { referralPointsBalance: POINTS_PER_REFERRAL });
  } catch (err) {
    logger.error({ err }, 'creditReferralOnRegistration failed');
  }
}
