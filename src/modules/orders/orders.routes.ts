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
});

const statusSchema = z.object({
  status: z.enum(['confirmed', 'in_progress', 'delivered', 'completed', 'cancelled']),
  reason: z.string().max(500).optional(),
});

const paySchema = z.object({ paymentType: z.enum(['advance', 'partial', 'final']).optional() });

ordersRouter.post('/', auth, validate({ body: placeSchema }), asyncHandler(async (req, res) => ok(res, await service.placeOrder(req.auth!.sub, req.body), 201)));
ordersRouter.get('/mine', auth, asyncHandler(async (req, res) => ok(res, await service.myOrders(req.auth!.sub))));
ordersRouter.get('/incoming', auth, asyncHandler(async (req, res) => ok(res, await service.incomingOrders(req.auth!.sub))));
ordersRouter.get('/:id', auth, asyncHandler(async (req, res) => ok(res, await service.getOrder(Number(req.params.id), req.auth!.sub))));
ordersRouter.patch('/:id/status', auth, validate({ body: statusSchema }), asyncHandler(async (req, res) => ok(res, await service.updateOrderStatus(Number(req.params.id), req.auth!.sub, req.body.status, req.body.reason))));
ordersRouter.post('/:id/pay', auth, validate({ body: paySchema }), asyncHandler(async (req, res) => ok(res, await service.payOrder(Number(req.params.id), req.auth!.sub, req.body.paymentType), 201)));
