import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './orders.service.js';

export const ordersRouter = Router();
const auth = authenticate('user');

const placeSchema = z.object({
  spProfileId: z.coerce.number().int(),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int(),
        quantity: z.coerce.number().positive().optional(),
        customizationNotes: z.string().max(500).optional(),
      }),
    )
    .min(1),
  deliveryType: z.enum(['home_delivery', 'pickup']).optional(),
  deliveryAddressId: z.coerce.number().int().optional(),
  couponCode: z.string().optional(),
  specialInstructions: z.string().max(1000).optional(),
  deliveryTimeWindow: z.string().max(100).optional(),
  scheduledSlot: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .optional(),
});

const statusSchema = z.object({
  status: z.enum(['confirmed', 'in_progress', 'delivered', 'completed', 'cancelled']),
  reason: z.string().max(500).optional(),
});

const paySchema = z.object({
  paymentType: z.enum(['advance', 'partial', 'final']).optional(),
  paymentMethod: z.enum(['upi', 'card', 'net_banking', 'cash', 'bank_transfer']).optional(),
  paymentSubMethod: z.string().trim().max(60).optional(),
});

const slotShape = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const bookingSchema = z.object({
  spProfileId: z.coerce.number().int(),
  rateType: z.enum(['per_session', 'monthly', 'hourly']),
  scheduledSlot: slotShape.optional(),
  couponCode: z.string().optional(),
  note: z.string().max(1000).optional(),
});

const quoteSchema = z.object({
  spProfileId: z.coerce.number().int(),
  orderKind: z.enum(['product', 'booking']).optional(),
  items: z.array(z.object({ productId: z.coerce.number().int(), quantity: z.coerce.number().positive().optional() })).optional(),
  rateType: z.enum(['per_session', 'monthly', 'hourly']).optional(),
  deliveryType: z.enum(['home_delivery', 'pickup']).optional(),
  couponCode: z.string().optional(),
});

const reasonSchema = z.object({ reason: z.string().max(500).optional() });

const directPaymentSchema = z.object({
  spProfileId: z.coerce.number().int(),
  amount: z.coerce.number().positive().max(1_000_000),
});

ordersRouter.post('/', auth, validate({ body: placeSchema }), asyncHandler(async (req, res) => ok(res, await service.placeOrder(req.auth!.sub, req.body), 201)));
ordersRouter.post('/bookings', auth, validate({ body: bookingSchema }), asyncHandler(async (req, res) => ok(res, await service.placeBooking(req.auth!.sub, req.body), 201)));
ordersRouter.post(
  '/direct-payment',
  auth,
  validate({ body: directPaymentSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.createDirectPayment(req.auth!.sub, req.body.spProfileId, req.body.amount), 201),
  ),
);
ordersRouter.post('/quote', auth, validate({ body: quoteSchema }), asyncHandler(async (req, res) => ok(res, await service.quoteOrder(req.body))));
ordersRouter.get('/mine', auth, asyncHandler(async (req, res) => ok(res, await service.myOrders(req.auth!.sub))));
ordersRouter.get('/incoming', auth, asyncHandler(async (req, res) => ok(res, await service.incomingOrders(req.auth!.sub))));
ordersRouter.get('/:id', auth, asyncHandler(async (req, res) => ok(res, await service.getOrder(Number(req.params.id), req.auth!.sub))));
ordersRouter.post('/:id/accept', auth, asyncHandler(async (req, res) => ok(res, await service.acceptOrder(Number(req.params.id), req.auth!.sub))));
ordersRouter.post('/:id/reject', auth, validate({ body: reasonSchema }), asyncHandler(async (req, res) => ok(res, await service.rejectOrder(Number(req.params.id), req.auth!.sub, req.body.reason))));
ordersRouter.patch('/:id/status', auth, validate({ body: statusSchema }), asyncHandler(async (req, res) => ok(res, await service.updateOrderStatus(Number(req.params.id), req.auth!.sub, req.body.status, req.body.reason))));
ordersRouter.post('/:id/pay', auth, validate({ body: paySchema }), asyncHandler(async (req, res) => ok(res, await service.payOrder(Number(req.params.id), req.auth!.sub, req.body), 201)));
