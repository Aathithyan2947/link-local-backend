import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import * as service from './discovery.service.js';

const listQuery = paginationSchema.extend({
  q: z.string().optional(),
  scope: z.enum(['society', 'lane', 'area', 'city']).optional(),
  areaId: z.coerce.number().int().optional(),
});
const spListQuery = listQuery.extend({ subcategoryId: z.coerce.number().int().optional() });
const ratingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});
const paySchema = z.object({ couponCode: z.string().optional() });
const deletionSchema = z.object({ reason: z.string().max(1000).optional() });

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  photoUrl: z.string().optional(),
  date: z.string(),
  startTime: z.string().optional(),
  durationMinutes: z.coerce.number().int().positive().optional(),
  mode: z.enum(['online', 'offline']),
  location: z.string().optional(),
  onlineLink: z.string().optional(),
  isPrivate: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  price: z.coerce.number().nonnegative().optional(),
  maxAttendees: z.coerce.number().int().positive().optional(),
  eligibilityMinAge: z.coerce.number().int().optional(),
  eligibilityGender: z.enum(['all', 'male', 'female']).optional(),
  allowCloning: z.boolean().optional(),
  adminApprovalNeeded: z.boolean().optional(),
  rawMaterials: z.array(z.string()).optional(),
});
const updateEventSchema = createEventSchema.partial();

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
  '/mine',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.myEvents(req.auth!.sub))),
);
eventsRouter.post(
  '/',
  authenticate('user'),
  validate({ body: createEventSchema }),
  asyncHandler(async (req, res) => ok(res, await service.createEvent(req.auth!.sub, req.body), 201)),
);
eventsRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.getEvent(Number(req.params.id), req.auth!.sub)),
  ),
);
eventsRouter.patch(
  '/:id',
  authenticate('user'),
  validate({ body: updateEventSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.updateEvent(Number(req.params.id), req.auth!.sub, req.body)),
  ),
);
eventsRouter.post(
  '/:id/join',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.joinEvent(Number(req.params.id), req.auth!.sub))),
);
eventsRouter.post(
  '/:id/withdraw',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.withdrawEvent(Number(req.params.id), req.auth!.sub)),
  ),
);
eventsRouter.post(
  '/:id/pay',
  authenticate('user'),
  validate({ body: paySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.payForEvent(Number(req.params.id), req.auth!.sub, req.body.couponCode), 201),
  ),
);
eventsRouter.post(
  '/:id/ratings',
  authenticate('user'),
  validate({ body: ratingSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.rateEvent(Number(req.params.id), req.auth!.sub, req.body), 201),
  ),
);
eventsRouter.post(
  '/:id/deletion-request',
  authenticate('user'),
  validate({ body: deletionSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.requestEventDeletion(Number(req.params.id), req.auth!.sub, req.body.reason), 201),
  ),
);

const createGroupSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  photoUrl: z.string().optional(),
  durationDays: z.coerce.number().int().positive().optional(),
  isPrivate: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  price: z.coerce.number().nonnegative().optional(),
  maxMembers: z.coerce.number().int().positive().optional(),
  eligibilityMinAge: z.coerce.number().int().optional(),
  eligibilityGender: z.enum(['all', 'male', 'female']).optional(),
  adminApprovalNeeded: z.boolean().optional(),
  multipleAdminsAllowed: z.boolean().optional(),
});
const updateGroupSchema = createGroupSchema.partial();
const groupPostSchema = z.object({
  textContent: z.string().max(5000).optional(),
  media: z.array(z.object({ mediaType: z.enum(['photo', 'video']), url: z.string() })).optional(),
});

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
  '/mine',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.myGroups(req.auth!.sub))),
);
groupsRouter.post(
  '/',
  authenticate('user'),
  validate({ body: createGroupSchema }),
  asyncHandler(async (req, res) => ok(res, await service.createGroup(req.auth!.sub, req.body), 201)),
);
groupsRouter.get(
  '/:id',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.getGroup(Number(req.params.id), req.auth!.sub)),
  ),
);
groupsRouter.patch(
  '/:id',
  authenticate('user'),
  validate({ body: updateGroupSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.updateGroup(Number(req.params.id), req.auth!.sub, req.body)),
  ),
);
groupsRouter.post(
  '/:id/join',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.joinGroup(Number(req.params.id), req.auth!.sub))),
);
groupsRouter.post(
  '/:id/leave',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.leaveGroup(Number(req.params.id), req.auth!.sub))),
);
groupsRouter.post(
  '/:id/pay',
  authenticate('user'),
  validate({ body: paySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.payForGroup(Number(req.params.id), req.auth!.sub, req.body.couponCode), 201),
  ),
);
groupsRouter.post(
  '/:id/ratings',
  authenticate('user'),
  validate({ body: ratingSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.rateGroup(Number(req.params.id), req.auth!.sub, req.body), 201),
  ),
);
groupsRouter.post(
  '/:id/posts',
  authenticate('user'),
  validate({ body: groupPostSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.createGroupPost(Number(req.params.id), req.auth!.sub, req.body), 201),
  ),
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
    ok(res, await service.getServiceProvider(Number(req.params.id), req.auth!.sub)),
  ),
);
const slotsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});
serviceProvidersRouter.get(
  '/:id/slots',
  authenticate('user'),
  validate({ query: slotsQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof slotsQuery>>(req);
    ok(res, await service.getServiceProviderSlots(Number(req.params.id), q.from, q.days));
  }),
);
serviceProvidersRouter.post(
  '/:id/ratings',
  authenticate('user'),
  validate({ body: ratingSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.rateServiceProvider(Number(req.params.id), req.auth!.sub, req.body), 201),
  ),
);

// ── Reviews submitted by the current user ────────────────────
export const reviewsRouter = Router();
reviewsRouter.get(
  '/mine',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.myReviews(req.auth!.sub))),
);
