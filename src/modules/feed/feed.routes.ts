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
  scope: z.enum(['society', 'lane', 'area', 'city']).optional(),
  areaId: z.coerce.number().int().optional(),
  /** One member's posts (a profile's "View More"), wherever they live. */
  userId: z.coerce.number().int().optional(),
});

const createPostSchema = z.object({
  postType: z.enum(['buy_sell', 'ask_help', 'offer_help', 'share_update']),
  textContent: z.string().max(5000).optional(),
  media: z
    .array(z.object({ mediaType: z.enum(['photo', 'video']), url: z.string().url() }))
    .optional(),
});

const likeSchema = z.object({ liked: z.boolean() });
const commentsQuery = paginationSchema.extend({ sort: z.enum(['top', 'newest']).default('top') });

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
  asyncHandler(async (req, res) => ok(res, await service.getPost(Number(req.params.id), req.auth!.sub))),
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

// Set a like to a given state — idempotent, so repeated taps can't double-count.
feedRouter.put(
  '/:id/like',
  authenticate('user'),
  validate({ body: likeSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setPostLike(req.auth!.sub, Number(req.params.id), req.body.liked)),
  ),
);
feedRouter.put(
  '/comments/:commentId/like',
  authenticate('user'),
  validate({ body: likeSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setCommentLike(req.auth!.sub, Number(req.params.commentId), req.body.liked)),
  ),
);
// Legacy toggle for a comment like (older app builds).
feedRouter.post(
  '/comments/:commentId/like',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.toggleCommentLike(req.auth!.sub, Number(req.params.commentId))),
  ),
);

// Comments panel: a page of top-level comments, then each thread's replies on demand.
feedRouter.get(
  '/:id/comments',
  authenticate('user'),
  validate({ query: commentsQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof commentsQuery>>(req);
    ok(res, await service.listComments(Number(req.params.id), req.auth!.sub, q));
  }),
);
feedRouter.get(
  '/comments/:commentId/replies',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.listReplies(Number(req.params.commentId), req.auth!.sub)),
  ),
);

/** How a post was shared. `chat` = sent in a LinkLocal chat; `in_app` is what builds before
 *  in-app sharing sent (kept so they don't break). Sharing to other apps will add its own. */
const shareSchema = z.object({ channel: z.enum(['chat', 'in_app']).default('chat') });

feedRouter.post(
  '/:id/share',
  authenticate('user'),
  validate({ body: shareSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.sharePost(req.auth!.sub, Number(req.params.id), req.body.channel), 201),
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
