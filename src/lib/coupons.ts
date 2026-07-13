import { prisma } from './prisma.js';

export interface ResolvedCoupon {
  couponId: number;
  discount: number;
}

/**
 * Validates a coupon code against `baseAmount` and returns the discount, or
 * null when the code is invalid / expired / exhausted. Does not mutate.
 */
export async function resolveCoupon(
  code: string | undefined,
  baseAmount: number,
): Promise<ResolvedCoupon | null> {
  if (!code) return null;
  const coupon = await prisma.couponCode.findFirst({ where: { code, isActive: true } });
  if (!coupon) return null;

  const now = new Date();
  if (coupon.validityFrom && coupon.validityFrom > now) return null;
  if (coupon.validityTo && coupon.validityTo < now) return null;
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) return null;

  const value = Number(coupon.discountValue);
  let discount = coupon.discountType === 'percent_off' ? (baseAmount * value) / 100 : value;
  discount = Math.min(Math.max(discount, 0), baseAmount);
  return { couponId: coupon.id, discount: Math.round(discount * 100) / 100 };
}

/** Records a coupon redemption: bumps used_count and writes the usage log. */
export async function redeemCoupon(
  couponId: number,
  userId: number,
  entityType: 'event' | 'group' | 'order',
  entityId: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.couponCode.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } }),
    prisma.couponUsageLog.create({ data: { couponId, userId, entityType, entityId } }),
  ]);
}
