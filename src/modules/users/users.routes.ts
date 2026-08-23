import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './users.service.js';

export const usersRouter = Router();
const auth = authenticate('user');

const blockSchema = z.object({ reason: z.string().max(500).optional() });

usersRouter.post(
  '/:id/block',
  auth,
  validate({ body: blockSchema }),
  asyncHandler(async (req, res) => ok(res, await service.blockUser(req.auth!.sub, Number(req.params.id), req.body.reason), 201)),
);
usersRouter.delete(
  '/:id/block',
  auth,
  asyncHandler(async (req, res) => ok(res, await service.unblockUser(req.auth!.sub, Number(req.params.id)))),
);
usersRouter.get(
  '/:id/block-status',
  auth,
  asyncHandler(async (req, res) => ok(res, await service.blockStatus(req.auth!.sub, Number(req.params.id)))),
);
usersRouter.get(
  '/blocked',
  auth,
  asyncHandler(async (req, res) => ok(res, await service.listBlocked(req.auth!.sub))),
);
