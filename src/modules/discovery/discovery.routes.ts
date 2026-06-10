import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import * as service from './discovery.service.js';

const listQuery = paginationSchema.extend({ q: z.string().optional() });
const spListQuery = listQuery.extend({ subcategoryId: z.coerce.number().int().optional() });

// ── Events ───────────────────────────────────────────────────
export const eventsRouter = Router();
eventsRouter.get(
  '/',
  authenticate('user'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const { items, meta } = await service.listEvents(req.auth!.sub, q);
    paginated(res, items, meta);
  }),
);
eventsRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.getEvent(Number(req.params.id)))),
);

// ── Groups ───────────────────────────────────────────────────
export const groupsRouter = Router();
groupsRouter.get(
  '/',
  authenticate('user'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const { items, meta } = await service.listGroups(req.auth!.sub, q);
    paginated(res, items, meta);
  }),
);
groupsRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.getGroup(Number(req.params.id)))),
);

// ── Service Providers ────────────────────────────────────────
export const serviceProvidersRouter = Router();
serviceProvidersRouter.get(
  '/',
  authenticate('user'),
  validate({ query: spListQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof spListQuery>>(req);
    const { items, meta } = await service.listServiceProviders(req.auth!.sub, q);
    paginated(res, items, meta);
  }),
);
serviceProvidersRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.getServiceProvider(Number(req.params.id))),
  ),
);
