import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdminRole } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { paginationSchema } from '../../utils/pagination.js';
import { ApiError } from '../../utils/ApiError.js';
import * as service from './admin.service.js';
import { writeAudit } from './audit.js';

export const adminRouter = Router();
const admin = authenticate('admin');
const superAdmin = [authenticate('admin'), requireAdminRole('super_admin')];

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

adminRouter.get(
  '/members/:id',
  admin,
  asyncHandler(async (req, res) => ok(res, await service.getMemberDetail(Number(req.params.id)))),
);

adminRouter.patch(
  '/members/:id/status',
  authenticate('admin'),
  validate({ body: memberStatusSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.setMemberStatus(Number(req.params.id), req.body)),
  ),
);

// ── Profile tags on a member ─────────────────────────────────
adminRouter.get(
  '/members/:id/tags',
  admin,
  asyncHandler(async (req, res) => ok(res, await service.getMemberTags(Number(req.params.id)))),
);

adminRouter.put(
  '/members/:id/tags',
  admin,
  validate({ body: z.object({ tagIds: z.array(z.number().int()).default([]) }) }),
  asyncHandler(async (req, res) => {
    const result = await service.setMemberTags(Number(req.params.id), req.body.tagIds, req.auth!.sub);
    await writeAudit(req.auth!.sub, 'set_member_tags', 'user', Number(req.params.id), { tagIds: req.body.tagIds });
    ok(res, result);
  }),
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
adminRouter.get(
  '/new-members',
  admin,
  validate({ query: z.object({ days: z.coerce.number().int().positive().max(365).optional() }) }),
  asyncHandler(async (req, res) => {
    const { days } = getValidatedQuery<{ days?: number }>(req);
    ok(res, await service.listNewMembers(days ?? 30));
  }),
);

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

const activityQuery = paginationSchema.extend({
  q: z.string().optional(),
  action: z.string().optional(),
  adminId: z.coerce.number().int().optional(),
  from: z.string().optional(), // YYYY-MM-DD
  to: z.string().optional(),
});

adminRouter.get(
  '/activity-logs',
  admin,
  validate({ query: activityQuery }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<z.infer<typeof activityQuery>>(req);
    const { items, meta } = await service.listActivityLogs(q);
    paginated(res, items, meta);
  }),
);

adminRouter.get('/reports', admin, asyncHandler(async (_req, res) => ok(res, await service.getReports())));

// ── Admins management (super admin only) ─────────────────────
const adminBaseSchema = z.object({
  name: z.string().min(1),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['super_admin', 'ops_admin']).default('ops_admin'),
});

adminRouter.get(
  '/admins',
  ...superAdmin,
  validate({ query: paginationSchema.extend({ q: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = getValidatedQuery<{ page: number; pageSize: number; q?: string }>(req);
    const { items, meta } = await service.listAdmins(q);
    paginated(res, items, meta);
  }),
);

adminRouter.post(
  '/admins',
  ...superAdmin,
  validate({ body: adminBaseSchema }),
  asyncHandler(async (req, res) => {
    const created = await service.createAdmin(req.body);
    await writeAudit(req.auth!.sub, 'create_admin', 'admin', created.id);
    ok(res, created, 201);
  }),
);

adminRouter.patch(
  '/admins/:id',
  ...superAdmin,
  validate({
    body: z.object({
      name: z.string().min(1).optional(),
      role: z.enum(['super_admin', 'ops_admin']).optional(),
      isActive: z.boolean().optional(),
      password: z.string().min(8, 'Password must be at least 8 characters').optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    // Prevent locking yourself out (self-deactivate or self-demote).
    if (id === req.auth!.sub && (req.body.isActive === false || (req.body.role && req.body.role !== 'super_admin'))) {
      throw ApiError.badRequest('You cannot deactivate or demote your own super-admin account');
    }
    const updated = await service.updateAdmin(id, req.body);
    await writeAudit(req.auth!.sub, 'update_admin', 'admin', id);
    ok(res, updated);
  }),
);
