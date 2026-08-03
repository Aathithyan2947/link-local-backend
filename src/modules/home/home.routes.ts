import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import * as service from './home.service.js';

export const homeRouter = Router();

const VALID_SCOPES: readonly string[] = ['society', 'lane', 'area', 'city'];

homeRouter.get(
  '/',
  authenticate('user'),
  asyncHandler(async (req, res) => {
    const rawScope = String(req.query.scope ?? 'city');
    const scope = (VALID_SCOPES.includes(rawScope) ? rawScope : 'city') as service.HomeScope;
    const rawAreaId = req.query.areaId;
    const areaId = rawAreaId !== undefined && !Number.isNaN(Number(rawAreaId)) ? Number(rawAreaId) : undefined;
    ok(res, await service.getHomeFeed(req.auth!.sub, { scope, areaId }));
  }),
);
