import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './home.service.js';

export const homeRouter = Router();

homeRouter.get(
  '/',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.getHomeFeed(req.auth!.sub))),
);
