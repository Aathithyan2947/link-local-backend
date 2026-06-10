import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import * as service from './admin.service.js';
import { writeAudit } from './audit.js';

export const adminRouter = Router();
const admin = authenticate('admin');

const membersQuery = paginationSchema.extend({
  q: z.string().optional(),
  userType: z.enum(['resident', 'service_provider', 'business_listing']).optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(),
});

const memberStatusSchema = z.object({
  isActive: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
  isVerified: z.boolean().optional(),
});

adminRouter.get(
  '/dashboard',
  authenticate('admin'),
  asyncHandler(async (_req, res) => ok(res, await service.getDashboard())),
);

adminRouter.get(
  '/members',
  authenticate('admin'),
  validate({ query: membersQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof membersQuery>>(req);
    const { items, meta } = await service.listMembers(q);
    paginated(res, items, meta);
  }),
);

adminRouter.patch(
  '/members/:id/status',
  authenticate('admin'),
  validate({ body: memberStatusSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setMemberStatus(Number(req.params.id), req.body)),
  ),
);

// ── Profile verification queue ───────────────────────────────
const verificationsQuery = paginationSchema.extend({
  status: z.enum(['pending', 'verified']).optional(),
});

adminRouter.get(
  '/verifications',
  admin,
  validate({ query: verificationsQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof verificationsQuery>>(req);
    const { items, meta } = await service.listVerifications(q);
    paginated(res, items, meta);
  }),
);

adminRouter.patch(
  '/verifications/:userId',
  admin,
  validate({ body: z.object({ status: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.reviewVerification(
      Number(req.params.userId),
      req.body.status,
      req.auth!.sub,
      req.body.rejectionReason,
    );
    await writeAudit(req.auth!.sub, `${req.body.status}_profile`, 'user', Number(req.params.userId));
    ok(res, result);
  }),
);

// ── "Other" service approval ─────────────────────────────────
adminRouter.get('/pending-services', admin, asyncHandler(async (_req, res) => ok(res, await service.listPendingServices())));

adminRouter.post(
  '/pending-services/:id/approve',
  admin,
  asyncHandler(async (req, res) => {
    const result = await service.approveService(Number(req.params.id));
    await writeAudit(req.auth!.sub, 'approve_service', 'service_subcategory', Number(req.params.id));
    ok(res, result);
  }),
);

// ── New members showcase ─────────────────────────────────────
adminRouter.get('/new-members', admin, asyncHandler(async (_req, res) => ok(res, await service.listNewMembers())));

// ── Events / Groups / Reports / Activity logs ────────────────
const listQuery = paginationSchema.extend({ q: z.string().optional() });

adminRouter.get(
  '/events',
  admin,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const { items, meta } = await service.listEventsAdmin(q);
    paginated(res, items, meta);
  }),
);

adminRouter.get(
  '/groups',
  admin,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof listQuery>>(req);
    const { items, meta } = await service.listGroupsAdmin(q);
    paginated(res, items, meta);
  }),
);

adminRouter.get(
  '/activity-logs',
  admin,
  validate({ query: paginationSchema }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<{ page: number; pageSize: number }>(req);
    const { items, meta } = await service.listActivityLogs(q);
    paginated(res, items, meta);
  }),
);

adminRouter.get('/reports', admin, asyncHandler(async (_req, res) => ok(res, await service.getReports())));
