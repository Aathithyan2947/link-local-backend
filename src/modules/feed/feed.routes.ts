import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import * as service from './feed.service.js';

export const feedRouter = Router();

const listQuery = paginationSchema.extend({
  postType: z.enum(['buy_sell', 'ask_help', 'offer_help', 'share_update']).optional(),
});

const createPostSchema = z.object({
  postType: z.enum(['buy_sell', 'ask_help', 'offer_help', 'share_update']),
  textContent: z.string().max(5000).optional(),
  media: z
    .array(z.object({ mediaType: z.enum(['photo', 'video']), url: z.string().url() }))
    .optional(),
});

const commentSchema = z.object({
  comment: z.string().min(1).max(2000),
  parentCommentId: z.number().int().optional(),
});

feedRouter.get(
  '/',
  authenticate('user'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const { items, meta } = await service.listPosts(req.auth!.sub, query);
    paginated(res, items, meta);
  }),
);

feedRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.getPost(Number(req.params.id)))),
);

feedRouter.post(
  '/',
  authenticate('user'),
  validate({ body: createPostSchema }),
  asyncHandler(async (req, res) => ok(res, await service.createPost(req.auth!.sub, req.body), 201)),
);

feedRouter.post(
  '/:id/like',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.toggleLike(req.auth!.sub, Number(req.params.id))),
  ),
);

feedRouter.post(
  '/:id/comments',
  authenticate('user'),
  validate({ body: commentSchema }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.addComment(
        req.auth!.sub,
        Number(req.params.id),
        req.body.comment,
        req.body.parentCommentId,
      ),
      201,
    ),
  ),
);
