import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';
import { mockCharge } from '../../lib/payments.js';
import { resolveCoupon, redeemCoupon } from '../../lib/coupons.js';
import { isSlotOpen, timeToDate, dateOnly } from '../../lib/slots.js';
import { PLATFORM_FEE } from '../../lib/providerKind.js';
import { getCustomFieldsForProfile } from '../../lib/customFields.js';

const orderInclude = {
  buyer: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  spProfile: { select: { id: true, userId: true, name: true, photoUrl: true } },
  items: { include: { product: { select: { id: true, name: true, photoUrl: true, quantityMetric: true } } } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  scheduledSlot: true,
};

// ── Fees ─────────────────────────────────────────────────────
export interface OrderFees {
  subtotal: number;
  deliveryCharge: number;
  packagingCharge: number;
  platformFee: number;
  discount: number;
  total: number;
  couponId?: number;
  freeDeliveryThreshold: number | null;
  freeDeliveryRemaining: number;
}

/** A menu-type SP's Delivery settings, resolved from their admin-configured custom fields
 *  (category 'delivery') rather than fixed columns — see [resolveDeliverySettings]. */
interface DeliverySettings {
  deliveryCharge: number;
  freeDeliveryThreshold: number | null;
  packagingCharge: number;
  asPerActuals: boolean;
}

/**
 * Resolves Delivery settings from the SP's admin-configured 'delivery'-category custom
 * fields, matched by field name (case-insensitive) — the same best-effort-by-name pattern
 * already used for payment-category fields elsewhere (see `createDirectPayment`). A field
 * that's unanswered or missing (e.g. a conditional field hidden behind "Shipping Charges: No")
 * simply defaults to 0/null/false, which is exactly the "not applicable" behavior wanted.
 */
async function resolveDeliverySettings(spProfileId: number): Promise<DeliverySettings> {
  const fields = await getCustomFieldsForProfile(spProfileId);
  const byName = (name: string) =>
    fields.find((f) => f.category === 'delivery' && f.fieldName.trim().toLowerCase() === name.toLowerCase())?.value;
  const num = (v: string | undefined) => {
    const n = Number(v);
    return v != null && v.trim() !== '' && Number.isFinite(n) ? n : null;
  };
  return {
    deliveryCharge: num(byName('Below Threshold')) ?? 0,
    freeDeliveryThreshold: num(byName('Free Delivery Threshold')),
    packagingCharge: num(byName('Packaging charges')) ?? 0,
    asPerActuals: byName('As Per Actuals') === 'true',
  };
}

/** Fee breakdown for a PRODUCT order (delivery/packaging/platform + coupon). */
async function computeProductFees(
  delivery: DeliverySettings,
  subtotal: number,
  deliveryType: 'home_delivery' | 'pickup',
  couponCode?: string,
): Promise<OrderFees> {
  const threshold = delivery.freeDeliveryThreshold;
  const meetsThreshold = threshold != null && subtotal >= threshold;
  const deliveryCharge =
    deliveryType === 'home_delivery' && !meetsThreshold && !delivery.asPerActuals ? delivery.deliveryCharge : 0;
  const packagingCharge = delivery.packagingCharge;
  const platformFee = subtotal > 0 ? PLATFORM_FEE : 0;
  const coupon = await resolveCoupon(couponCode, subtotal);
  const discount = coupon?.discount ?? 0;
  const total = Math.max(subtotal + deliveryCharge + packagingCharge + platformFee - discount, 0);
  return {
    subtotal,
    deliveryCharge,
    packagingCharge,
    platformFee,
    discount,
    total,
    couponId: coupon?.couponId,
    freeDeliveryThreshold: threshold,
    freeDeliveryRemaining: threshold != null && !meetsThreshold ? Math.max(threshold - subtotal, 0) : 0,
  };
}

/** Snapshot + validate product line items against the SP's catalogue. */
async function buildItemRows(
  spProfileId: number,
  items: { productId: number; quantity?: number; customizationNotes?: string }[],
) {
  const productIds = items.map((i) => i.productId);
  const products = await prisma.spProduct.findMany({ where: { id: { in: productIds }, profileId: spProfileId } });
  if (products.length !== new Set(productIds).size) throw ApiError.badRequest('One or more items are unavailable');
  const priceOf = new Map(products.map((p) => [p.id, Number(p.price ?? 0)]));
  return items.map((i) => {
    const qty = i.quantity && i.quantity > 0 ? i.quantity : 1;
    const unit = priceOf.get(i.productId) ?? 0;
    return {
      productId: i.productId,
      quantity: qty,
      unitPrice: unit,
      totalPrice: Math.round(unit * qty * 100) / 100,
      customizationNotes: i.customizationNotes,
    };
  });
}

// ── Quote (cart fee breakdown + coupon preview, no persistence) ──
export interface QuoteInput {
  spProfileId: number;
  orderKind?: 'product' | 'booking';
  items?: { productId: number; quantity?: number }[];
  rateType?: 'per_session' | 'monthly' | 'hourly';
  deliveryType?: 'home_delivery' | 'pickup';
  couponCode?: string;
}

export async function quoteOrder(data: QuoteInput): Promise<OrderFees> {
  const sp = await prisma.profile.findUnique({ where: { id: data.spProfileId }, select: { id: true } });
  if (!sp) throw ApiError.notFound('Service provider not found');

  if (data.orderKind === 'booking') {
    const rate = await requireRate(data.spProfileId, data.rateType);
    const coupon = await resolveCoupon(data.couponCode, rate);
    const discount = coupon?.discount ?? 0;
    return {
      subtotal: rate,
      deliveryCharge: 0,
      packagingCharge: 0,
      platformFee: 0,
      discount,
      total: Math.max(rate - discount, 0),
      couponId: coupon?.couponId,
      freeDeliveryThreshold: null,
      freeDeliveryRemaining: 0,
    };
  }

  const rows = await buildItemRows(data.spProfileId, (data.items ?? []).map((i) => ({ ...i })));
  const subtotal = rows.reduce((s, r) => s + r.totalPrice, 0);
  const delivery = await resolveDeliverySettings(data.spProfileId);
  return computeProductFees(delivery, subtotal, data.deliveryType ?? 'pickup', data.couponCode);
}

// ── Product order ────────────────────────────────────────────
export interface PlaceOrderInput {
  spProfileId: number;
  items: { productId: number; quantity?: number; customizationNotes?: string }[];
  deliveryType?: 'home_delivery' | 'pickup';
  deliveryAddressId?: number;
  couponCode?: string;
  specialInstructions?: string;
  deliveryTimeWindow?: string;
  scheduledSlot?: { date: string; startTime: string; endTime: string };
}

export async function placeOrder(buyerId: number, data: PlaceOrderInput) {
  if (!data.items.length) throw ApiError.badRequest('Your cart is empty');

  const sp = await prisma.profile.findUnique({
    where: { id: data.spProfileId },
    select: { id: true, userId: true, name: true },
  });
  if (!sp) throw ApiError.notFound('Service provider not found');
  if (sp.userId === buyerId) throw ApiError.badRequest('You cannot order from yourself');

  const itemRows = await buildItemRows(data.spProfileId, data.items);
  const subtotal = itemRows.reduce((s, r) => s + r.totalPrice, 0);
  const deliveryType = data.deliveryType ?? 'pickup';
  const delivery = await resolveDeliverySettings(data.spProfileId);
  const fees = await computeProductFees(delivery, subtotal, deliveryType, data.couponCode);

  // Each slot is single-booking (capacity 1) — reject if it was taken in the meantime.
  const slot = data.scheduledSlot;
  if (slot && !(await isSlotOpen(data.spProfileId, slot))) {
    throw ApiError.conflict('That time slot was just taken. Please pick another.');
  }

  const { id: orderId } = await prisma.$transaction(
    async (tx) => {
      const created = await tx.order.create({
        data: {
          buyerId,
          spProfileId: data.spProfileId,
          orderKind: 'product',
          status: 'placed',
          deliveryType,
          deliveryAddressId: data.deliveryAddressId,
          subtotal,
          deliveryCharge: fees.deliveryCharge,
          packagingCharge: fees.packagingCharge,
          platformFee: fees.platformFee,
          discountApplied: fees.discount,
          totalAmount: fees.total,
          couponId: fees.couponId,
          specialInstructions: data.specialInstructions,
          deliveryTimeWindow: data.deliveryTimeWindow,
          items: { create: itemRows },
        },
        select: { id: true },
      });
      if (slot) await lockSlot(tx, data.spProfileId, buyerId, created.id, slot);
      return created;
    },
    { timeout: 15_000 },
  );
  if (fees.couponId) await redeemCoupon(fees.couponId, buyerId, 'order', orderId);

  await emitNotification({
    userId: sp.userId,
    title: 'New order',
    body: `You received a new order (₹${fees.total.toFixed(0)})`,
    type: 'order_update',
    entityType: 'order',
    entityId: orderId,
  });
  return prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
}

// ── Service booking (request → accept → pay) ─────────────────
export interface PlaceBookingInput {
  spProfileId: number;
  rateType: 'per_session' | 'monthly' | 'hourly';
  scheduledSlot?: { date: string; startTime: string; endTime: string };
  couponCode?: string;
  note?: string;
}

const RATE_LABEL: Record<string, string> = { per_session: 'per session', monthly: 'monthly', hourly: 'hourly' };

async function requireRate(spProfileId: number, rateType?: string): Promise<number> {
  if (!rateType) throw ApiError.badRequest('Pick a rate');
  const rate = await prisma.spRate.findFirst({ where: { profileId: spProfileId, rateType, isActive: true } });
  if (!rate) throw ApiError.badRequest('That rate is unavailable');
  return Number(rate.amount);
}

export async function placeBooking(buyerId: number, data: PlaceBookingInput) {
  const sp = await prisma.profile.findUnique({ where: { id: data.spProfileId }, select: { id: true, userId: true } });
  if (!sp) throw ApiError.notFound('Service provider not found');
  if (sp.userId === buyerId) throw ApiError.badRequest('You cannot book yourself');

  const rateAmount = await requireRate(data.spProfileId, data.rateType);
  const coupon = await resolveCoupon(data.couponCode, rateAmount);
  const discount = coupon?.discount ?? 0;
  const total = Math.max(rateAmount - discount, 0);

  const slot = data.scheduledSlot;
  if (slot && !(await isSlotOpen(data.spProfileId, slot))) {
    throw ApiError.conflict('That time slot was just taken. Please pick another.');
  }

  const { id: orderId } = await prisma.$transaction(
    async (tx) => {
      const created = await tx.order.create({
        data: {
          buyerId,
          spProfileId: data.spProfileId,
          orderKind: 'booking',
          status: 'requested',
          subtotal: rateAmount,
          rateType: data.rateType,
          rateAmount,
          discountApplied: discount,
          totalAmount: total,
          couponId: coupon?.couponId,
          specialInstructions: data.note,
        },
        select: { id: true },
      });
      if (slot) await lockSlot(tx, data.spProfileId, buyerId, created.id, slot);
      return created;
    },
    { timeout: 15_000 },
  );
  if (coupon) await redeemCoupon(coupon.couponId, buyerId, 'order', orderId);

  await emitNotification({
    userId: sp.userId,
    title: 'New booking request',
    body: `You have a new ${RATE_LABEL[data.rateType]} booking request`,
    type: 'enquiry',
    entityType: 'order',
    entityId: orderId,
  });
  return prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
}

/**
 * Instant "pay this provider" for non-menu (service) SPs — no request/accept step, unlike
 * `placeBooking`. Used from the SP profile's "Make Payment" action. Menu/product SPs never
 * call this: their payment always goes through a real placed order instead.
 *
 * The amount is entered by the resident (services are priced by direct negotiation with the
 * SP — the "Payment & Fee" rate shown on the profile is a reference, not a fixed charge), so
 * it's taken as-is from the caller rather than resolved from `SpRate`/custom fields.
 */
export async function createDirectPayment(buyerId: number, spProfileId: number, amount: number) {
  const sp = await prisma.profile.findUnique({ where: { id: spProfileId }, select: { id: true, userId: true } });
  if (!sp) throw ApiError.notFound('Service provider not found');
  if (sp.userId === buyerId) throw ApiError.badRequest('You cannot pay yourself');

  // Cosmetic context on the order only — best-effort, never blocks creation.
  const fields = (await getCustomFieldsForProfile(spProfileId, { onlyAnswered: true })).filter(
    (f) => f.category === 'payment',
  );
  const typeValue = fields.find((f) => /payment type/i.test(f.fieldName))?.value?.toLowerCase() ?? '';
  const rateType = typeValue.includes('month') ? 'monthly' : typeValue.includes('session') ? 'per_session' : null;

  const order = await prisma.order.create({
    data: {
      buyerId,
      spProfileId,
      orderKind: 'booking',
      status: 'accepted',
      subtotal: amount,
      totalAmount: amount,
      rateType,
      rateAmount: amount,
      acceptedAt: new Date(),
    },
  });
  return prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
}

/** Materialize + lock a slot for an order (used by both product and booking placement). */
async function lockSlot(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  spProfileId: number,
  buyerId: number,
  orderId: number,
  slot: { date: string; startTime: string; endTime: string },
) {
  const booked = await tx.spScheduleSlot.create({
    data: {
      profileId: spProfileId,
      slotDate: dateOnly(slot.date),
      startTime: timeToDate(slot.startTime),
      endTime: timeToDate(slot.endTime),
      isAvailable: false,
      bookedBy: buyerId,
      orderId,
    },
    select: { id: true },
  });
  await tx.order.update({ where: { id: orderId }, data: { scheduledSlotId: booked.id } });
}

// ── Reads ────────────────────────────────────────────────────
export async function getOrder(id: number, viewerId: number) {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.buyerId !== viewerId && order.spProfile.userId !== viewerId) {
    throw ApiError.forbidden('You cannot view this order');
  }
  return order;
}

export async function myOrders(buyerId: number) {
  return prisma.order.findMany({ where: { buyerId }, orderBy: { placedAt: 'desc' }, include: orderInclude });
}

export async function incomingOrders(spUserId: number) {
  return prisma.order.findMany({
    where: { spProfile: { userId: spUserId } },
    orderBy: { placedAt: 'desc' },
    include: orderInclude,
  });
}

// ── Accept / Reject (SP) ─────────────────────────────────────
async function requireSpOrder(orderId: number, spUserId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { spProfile: { select: { userId: true } } },
  });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.spProfile.userId !== spUserId) throw ApiError.forbidden('Not your order');
  return order;
}

/** SP accepts: product placed→confirmed; booking requested→accepted (buyer then pays). */
export async function acceptOrder(orderId: number, spUserId: number) {
  const order = await requireSpOrder(orderId, spUserId);
  const isBooking = order.orderKind === 'booking';
  const from = isBooking ? 'requested' : 'placed';
  if (order.status !== from) throw ApiError.badRequest(`Cannot accept an order that is ${order.status}`);
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: isBooking ? 'accepted' : 'confirmed',
      acceptedAt: new Date(),
      ...(isBooking ? {} : { confirmedAt: new Date() }),
    },
    include: orderInclude,
  });
  await emitNotification({
    userId: order.buyerId,
    title: isBooking ? 'Request confirmed' : 'Order accepted',
    body: isBooking ? 'Your booking request was accepted — confirm & pay to finalise.' : `Order #${orderId} was accepted`,
    type: 'order_update',
    entityType: 'order',
    entityId: orderId,
  });
  return updated;
}

/** SP rejects: frees any held slot and notifies the buyer. */
export async function rejectOrder(orderId: number, spUserId: number, reason?: string) {
  const order = await requireSpOrder(orderId, spUserId);
  if (['completed', 'cancelled', 'rejected'].includes(order.status)) {
    throw ApiError.badRequest(`Cannot reject an order that is ${order.status}`);
  }
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: 'rejected', rejectedAt: new Date(), cancellationReason: reason },
    include: orderInclude,
  });
  await freeSlot(orderId);
  await emitNotification({
    userId: order.buyerId,
    title: order.orderKind === 'booking' ? 'Request declined' : 'Order declined',
    body: `Your request was declined${reason ? `: ${reason}` : ''}`,
    type: 'order_update',
    entityType: 'order',
    entityId: orderId,
  });
  return updated;
}

// ── Fulfilment status (SP) + cancel (buyer/SP) ───────────────
const STATUS_FLOW = ['placed', 'confirmed', 'in_progress', 'delivered', 'completed'];
const STAMP: Record<string, string> = {
  confirmed: 'confirmedAt',
  delivered: 'deliveredAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

export async function updateOrderStatus(orderId: number, actorUserId: number, status: string, reason?: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { spProfile: { select: { userId: true } } },
  });
  if (!order) throw ApiError.notFound('Order not found');

  const isBuyer = order.buyerId === actorUserId;
  const isSp = order.spProfile.userId === actorUserId;
  if (!isBuyer && !isSp) throw ApiError.forbidden('Not your order');

  // Buyers may only cancel; SPs drive the fulfilment flow.
  if (status === 'cancelled') {
    // allowed for either party
  } else if (!isSp) {
    throw ApiError.forbidden('Only the seller can update this order');
  } else if (!STATUS_FLOW.includes(status)) {
    throw ApiError.badRequest('Invalid status');
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status,
      cancellationReason: status === 'cancelled' ? reason : undefined,
      ...(STAMP[status] ? { [STAMP[status]]: new Date() } : {}),
    },
    include: orderInclude,
  });

  if (status === 'completed') await bumpUserStats(order.spProfile.userId, { ordersReceived: 1 });
  // Cancelling frees any slot this order held so it re-opens for other residents.
  if (status === 'cancelled') await freeSlot(orderId);

  const notifyUser = isSp ? order.buyerId : order.spProfile.userId;
  await emitNotification({
    userId: notifyUser,
    title: 'Order update',
    body: `Order #${orderId} is now ${status.replace('_', ' ')}`,
    type: 'order_update',
    entityType: 'order',
    entityId: orderId,
  });
  return updated;
}

async function freeSlot(orderId: number) {
  await prisma.spScheduleSlot.updateMany({
    where: { orderId, isAvailable: false },
    data: { isAvailable: true, bookedBy: null, orderId: null },
  });
}

// ── Payment (MOCK gateway) ───────────────────────────────────
export async function payOrder(
  orderId: number,
  buyerId: number,
  opts: { paymentType?: string; paymentMethod?: string } = {},
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { spProfile: { select: { userId: true } } },
  });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.buyerId !== buyerId) throw ApiError.forbidden('Not your order');
  // A booking must be accepted by the SP before the resident can pay.
  if (order.orderKind === 'booking' && order.status !== 'accepted') {
    throw ApiError.badRequest('This booking is not ready for payment yet');
  }

  const amount = Number(order.totalAmount);
  const charge = mockCharge(amount); // MOCK gateway
  const payment = await prisma.orderPayment.create({
    data: {
      orderId,
      amount,
      paymentType: opts.paymentType ?? 'advance',
      paymentMethod: opts.paymentMethod ?? 'upi',
      paymentStatus: 'paid',
      transactionRef: charge.transactionRef,
      paidAt: charge.paidAt,
    },
  });
  // Paying a booking confirms it.
  if (order.orderKind === 'booking' && order.status === 'accepted') {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'confirmed', confirmedAt: new Date() } });
  }
  await bumpUserStats(order.spProfile.userId, { paymentReceivedTotal: amount });
  await emitNotification({
    userId: order.spProfile.userId,
    title: 'Payment received',
    body: `Payment of ₹${amount.toFixed(0)} received for order #${orderId}`,
    type: 'payment',
    entityType: 'order',
    entityId: orderId,
  });
  return payment;
}
