import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './referrals.service.js';

export const referralsRouter = Router();
const auth = authenticate('user');

const inviteSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  channel: z.enum(['whatsapp', 'sms', 'other']).optional(),
});

referralsRouter.get('/mine', auth, asyncHandler(async (req, res) => ok(res, await service.myReferrals(req.auth!.sub))));
referralsRouter.post(
  '/invite',
  auth,
  validate({ body: inviteSchema }),
  asyncHandler(async (req, res) => ok(res, await service.sendInvite(req.auth!.sub, req.body), 201)),
);
