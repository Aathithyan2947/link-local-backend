import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { bumpUserStats } from '../../lib/stats.js';
import { emitNotification } from '../../lib/notify.js';
import { mockCharge } from '../../lib/payments.js';
import { resolveCoupon, redeemCoupon } from '../../lib/coupons.js';

const orderInclude = {
  buyer: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
  spProfile: { select: { id: true, userId: true, name: true, photoUrl: true } },
  items: { include: { product: { select: { id: true, name: true, photoUrl: true, quantityMetric: true } } } },
  payments: { orderBy: { createdAt: 'desc' as const } },
};

export interface PlaceOrderInput {
  spProfileId: number;
  items: { productId: number; quantity?: number; customizationNotes?: string }[];
  deliveryType?: 'home_delivery' | 'pickup';
  deliveryAddressId?: number;
  couponCode?: string;
  specialInstructions?: string;
}

export async function placeOrder(buyerId: number, data: PlaceOrderInput) {
  if (!data.items.length) throw ApiError.badRequest('Your cart is empty');

  const sp = await prisma.profile.findUnique({
    where: { id: data.spProfileId },
    select: { id: true, userId: true, name: true, delivery: true },
  });
  if (!sp) throw ApiError.notFound('Service provider not found');
  if (sp.userId === buyerId) throw ApiError.badRequest('You cannot order from yourself');

  // Snapshot product prices; validate they belong to this SP.
  const productIds = data.items.map((i) => i.productId);
  const products = await prisma.spProduct.findMany({
    where: { id: { in: productIds }, profileId: data.spProfileId },
  });
  const priceOf = new Map(products.map((p) => [p.id, Number(p.price ?? 0)]));
  if (products.length !== new Set(productIds).size) {
    throw ApiError.badRequest('One or more items are unavailable');
  }

  const itemRows = data.items.map((i) => {
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

  const subtotal = itemRows.reduce((s, r) => s + r.totalPrice, 0);
  const deliveryType = data.deliveryType ?? 'pickup';
  const deliveryCharge =
    deliveryType === 'home_delivery' ? Number(sp.delivery?.deliveryCharge ?? 0) : 0;
  const coupon = await resolveCoupon(data.couponCode, subtotal);
  const discount = coupon?.discount ?? 0;
  const total = Math.max(subtotal + deliveryCharge - discount, 0);

  const order = await prisma.order.create({
    data: {
      buyerId,
      spProfileId: data.spProfileId,
      status: 'placed',
      deliveryType,
      deliveryAddressId: data.deliveryAddressId,
      subtotal,
      deliveryCharge,
      discountApplied: discount,
      totalAmount: total,
      couponId: coupon?.couponId,
      specialInstructions: data.specialInstructions,
      items: { create: itemRows },
    },
    include: orderInclude,
  });
  if (coupon) await redeemCoupon(coupon.couponId, buyerId, 'order', order.id);

  await emitNotification({
    userId: sp.userId,
    title: 'New order',
    body: `You received a new order (₹${total.toFixed(0)})`,
    type: 'order_update',
    entityType: 'order',
    entityId: order.id,
  });
  return order;
}

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

const STATUS_FLOW = ['placed', 'confirmed', 'in_progress', 'delivered', 'completed'];
const STAMP: Record<string, string> = {
  confirmed: 'confirmedAt',
  delivered: 'deliveredAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

export async function updateOrderStatus(
  orderId: number,
  actorUserId: number,
  status: string,
  reason?: string,
) {
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
    if (!isBuyer && !isSp) throw ApiError.forbidden('Cannot cancel');
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

  if (status === 'completed') {
    await bumpUserStats(order.spProfile.userId, { ordersReceived: 1 });
  }
  // Notify the counterparty.
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

export async function payOrder(orderId: number, buyerId: number, paymentType = 'advance') {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { spProfile: { select: { userId: true } } },
  });
  if (!order) throw ApiError.notFound('Order not found');
  if (order.buyerId !== buyerId) throw ApiError.forbidden('Not your order');

  const amount = Number(order.totalAmount);
  const charge = mockCharge(amount); // MOCK gateway
  const payment = await prisma.orderPayment.create({
    data: {
      orderId,
      amount,
      paymentType,
      paymentMethod: 'upi',
      paymentStatus: 'paid',
      transactionRef: charge.transactionRef,
      paidAt: charge.paidAt,
    },
  });
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
