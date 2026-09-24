import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { getValidatedQuery, validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import type { HomeScope } from '../home/home.service.js';
import * as service from './members.service.js';

export const membersRouter = Router();

const listSchema = paginationSchema.extend({
  scope: z.enum(['society', 'lane', 'area', 'city']).default('city'),
  areaId: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).optional(),
});

// Members visible to the caller in a scope — the list behind Home's "Members" counter.
membersRouter.get(
  '/',
  authenticate('user'),
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema> & { scope: HomeScope }>(req);
    const { items, meta } = await service.listMembers(req.auth!.sub, query);
    paginated(res, items, meta);
  }),
);

export default membersRouter;
