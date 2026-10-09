import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './referrals.service.js';

export const referralsRouter = Router();
const auth = authenticate('user');

/** An invite's mobile as 10 plain digits: drops spaces / dashes and a leading +91, 91 or 0, so
 *  it matches the number the friend later signs up with. */
export function normalizeIndianMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export const INVITE_NAME_MAX = 50;

export const inviteSchema = z.object({
  // Optional: a blank name counts as none.
  name: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .max(INVITE_NAME_MAX, `Name can be at most ${INVITE_NAME_MAX} characters`)
      .regex(/^[\p{L}\p{M} .'-]+$/u, 'Name can have letters and spaces only')
      .optional(),
  ),
  phone: z.preprocess(
    (v) => (typeof v === 'string' ? normalizeIndianMobile(v) : v),
    z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').optional(),
  ),
  channel: z.enum(['whatsapp', 'sms', 'other']).optional(),
});

referralsRouter.get('/mine', auth, asyncHandler(async (req, res) => ok(res, await service.myReferrals(req.auth!.sub))));
referralsRouter.post(
  '/invite',
  auth,
  validate({ body: inviteSchema }),
  asyncHandler(async (req, res) => ok(res, await service.sendInvite(req.auth!.sub, req.body), 201)),
);
