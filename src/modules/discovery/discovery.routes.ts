import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import * as service from './discovery.service.js';
import { requireAddressProof } from '../../lib/addressProof.js';
import {
  CONTENT_LIMITS as L,
  descriptionField,
  postTextField,
  priceField,
  requirePriceWhenPaid,
  titleField,
} from '../../lib/contentLimits.js';

const listQuery = paginationSchema.extend({
  q: z.string().optional(),
  scope: z.enum(['society', 'lane', 'area', 'city']).optional(),
  areaId: z.coerce.number().int().optional(),
});
const eventListQuery = listQuery.extend({
  upcoming: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const spListQuery = listQuery.extend({ subcategoryId: z.coerce.number().int().optional() });
/** My Groups → "Groups near you": `excludeMine` leaves out groups the caller created, joined
 *  or is waiting to be approved for. */
const groupListQuery = listQuery.extend({
  excludeMine: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
const ratingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});
const paySchema = z.object({ couponCode: z.string().optional() });
const mutedSchema = z.object({ muted: z.boolean() });
const deletionSchema = z.object({ reason: z.string().max(1000).optional() });

// Limits and messages mirror the app's content_limits.dart (BUG-071/073/074). The base object
// is refined separately for create and update: zod can't `.partial()` a refined schema.
const durationMsg = `Duration must be between ${L.durationMin} and ${L.durationMax} minutes`;
const maxAttendeesMsg = `Max attendees must be between ${L.maxAttendeesMin} and 10,000`;
const eventFields = z.object({
  title: titleField('Event title'),
  description: descriptionField.optional(),
  photoUrl: z.string().optional(),
  date: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Enter a valid date'),
  // Required on create (see createEventSchema). Without one the event "started" at midnight
  // and showed Closed the moment it was created.
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Pick a start time').optional(),
  durationMinutes: z.coerce.number().int(durationMsg).min(L.durationMin, durationMsg).max(L.durationMax, durationMsg).optional(),
  mode: z.enum(['online', 'offline']),
  location: z.string().trim().max(L.location, `Location can be at most ${L.location} characters`).optional(),
  onlineLink: z.string().trim().max(L.onlineLink, `Link can be at most ${L.onlineLink} characters`).optional(),
  // Set when the location was picked from place search; null clears them (typed location).
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  googlePlaceId: z.string().max(300).nullable().optional(),
  isPrivate: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  price: priceField.optional(),
  maxAttendees: z.coerce
    .number()
    .int(maxAttendeesMsg)
    .min(L.maxAttendeesMin, maxAttendeesMsg)
    .max(L.maxAttendeesMax, maxAttendeesMsg)
    .optional(),
  eligibilityMinAge: z.coerce.number().int().optional(),
  eligibilityGender: z.enum(['all', 'male', 'female']).optional(),
  allowCloning: z.boolean().optional(),
  adminApprovalNeeded: z.boolean().optional(),
  rawMaterials: z
    .array(z.string().trim().max(L.materialItem, `Each item can be at most ${L.materialItem} characters`))
    .max(L.materialItems, `Add at most ${L.materialItems} items`)
    .optional(),
});

const LINK = /^https?:\/\/\S+$/i;
/** Where it happens must match how: a place for in-person events, a link for online ones. */
function checkEvent(
  d: { mode?: 'online' | 'offline'; location?: string; onlineLink?: string; isPaid?: boolean; price?: number },
  ctx: z.RefinementCtx,
) {
  if (d.mode === 'offline' && !d.location?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['location'], message: 'Enter the event location' });
  }
  if (d.mode === 'online' && !d.onlineLink?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['onlineLink'], message: 'Enter the event link' });
  } else if (d.onlineLink?.trim() && !LINK.test(d.onlineLink.trim())) {
    ctx.addIssue({ code: 'custom', path: ['onlineLink'], message: 'Enter a valid link starting with http:// or https://' });
  }
  requirePriceWhenPaid(d, ctx, 'event');
}
const createEventSchema = eventFields.superRefine((d, ctx) => {
  if (!d.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Pick a start time' });
  checkEvent(d, ctx);
});
const updateEventSchema = eventFields.partial().superRefine(checkEvent);

// ── Events ───────────────────────────────────────────────────
export const eventsRouter = Router();
eventsRouter.get(
  '/',
  authenticate('user'),
  validate({ query: eventListQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof eventListQuery>>(req);
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
  requireAddressProof('host an event'),
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
  requireAddressProof('join an event'),
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
  requireAddressProof('join an event'),
  validate({ body: paySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.payForEvent(Number(req.params.id), req.auth!.sub, req.body.couponCode), 201),
  ),
);
eventsRouter.post(
  '/:id/ratings',
  authenticate('user'),
  requireAddressProof('submit a review'),
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

const maxMembersMsg = `Max members must be between ${L.maxMembersMin} and 10,000`;
const groupFields = z.object({
  title: titleField('Group name'),
  description: descriptionField.optional(),
  photoUrl: z.string().optional(),
  durationDays: z.coerce.number().int().positive().optional(),
  isPrivate: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  price: priceField.optional(),
  // At least 2: the creator is a member, so 1 would mean nobody could ever join.
  maxMembers: z.coerce
    .number()
    .int(maxMembersMsg)
    .min(L.maxMembersMin, maxMembersMsg)
    .max(L.maxMembersMax, maxMembersMsg)
    .optional(),
  eligibilityMinAge: z.coerce.number().int().optional(),
  eligibilityGender: z.enum(['all', 'male', 'female']).optional(),
  adminApprovalNeeded: z.boolean().optional(),
  multipleAdminsAllowed: z.boolean().optional(),
});
const createGroupSchema = groupFields.superRefine((d, ctx) => requirePriceWhenPaid(d, ctx, 'group'));
const updateGroupSchema = groupFields.partial().superRefine((d, ctx) => requirePriceWhenPaid(d, ctx, 'group'));
const groupPostSchema = z.object({
  textContent: postTextField.optional(),
  media: z.array(z.object({ mediaType: z.enum(['photo', 'video']), url: z.string() })).optional(),
});

// ── Groups ───────────────────────────────────────────────────
export const groupsRouter = Router();
groupsRouter.get(
  '/',
  authenticate('user'),
  validate({ query: groupListQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof groupListQuery>>(req);
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
  requireAddressProof('start a group'),
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
  requireAddressProof('join a group'),
  asyncHandler(async (req, res) => ok(res, await service.joinGroup(Number(req.params.id), req.auth!.sub))),
);
// The admin names a member to take over (BUG-081); everyone else, and older app builds, send
// no body at all.
const leaveGroupSchema = z
  .object({ newAdminUserId: z.coerce.number().int().positive().optional() })
  .default({});
groupsRouter.post(
  '/:id/leave',
  authenticate('user'),
  validate({ body: leaveGroupSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.leaveGroup(Number(req.params.id), req.auth!.sub, req.body.newAdminUserId)),
  ),
);
groupsRouter.post(
  '/:id/pay',
  authenticate('user'),
  requireAddressProof('join a group'),
  validate({ body: paySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.payForGroup(Number(req.params.id), req.auth!.sub, req.body.couponCode), 201),
  ),
);
groupsRouter.post(
  '/:id/ratings',
  authenticate('user'),
  requireAddressProof('submit a review'),
  validate({ body: ratingSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.rateGroup(Number(req.params.id), req.auth!.sub, req.body), 201),
  ),
);
groupsRouter.get(
  '/:id/discussions',
  authenticate('user'),
  validate({ query: z.object({ areaId: z.coerce.number().int().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<{ areaId?: number }>(req);
    ok(res, await service.listGroupDiscussions(Number(req.params.id), req.auth!.sub, q.areaId));
  }),
);
groupsRouter.get(
  '/:id/members',
  authenticate('user'),
  asyncHandler(async (req, res) => ok(res, await service.listGroupMembers(Number(req.params.id)))),
);
groupsRouter.post(
  '/:id/mute',
  authenticate('user'),
  validate({ body: mutedSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setGroupMuted(Number(req.params.id), req.auth!.sub, req.body.muted)),
  ),
);
groupsRouter.post(
  '/:id/clear-chat',
  authenticate('user'),
  asyncHandler(async (req, res) =>
    ok(res, await service.clearGroupChat(Number(req.params.id), req.auth!.sub)),
  ),
);
groupsRouter.post(
  '/:id/posts',
  authenticate('user'),
  requireAddressProof('post in a group'),
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
// All Services (BUG-087). Before '/:id', which would otherwise take "services" as an id.
serviceProvidersRouter.get(
  '/services',
  authenticate('user'),
  validate({ query: listQuery.pick({ scope: true, areaId: true }) }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<{ scope?: 'society' | 'lane' | 'area' | 'city'; areaId?: number }>(req);
    ok(res, await service.listServiceCatalog(req.auth!.sub, q));
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
  requireAddressProof('submit a review'),
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
