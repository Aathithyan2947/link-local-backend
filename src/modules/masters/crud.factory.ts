import { Router, type Request } from 'express';
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, paginationSchema, toPrismaPagination } from '../../utils/pagination.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Delegate {
  findMany: (args?: any) => Promise<any[]>;
  count: (args?: any) => Promise<number>;
  findUnique: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
}

interface CrudOptions {
  /** Prisma model name in camelCase, e.g. "city". */
  model: string;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  /** Fields searched (case-insensitive contains) by the `q` query param. */
  searchFields?: string[];
  /** Extra filterable scalar fields exposed as query params. */
  filterFields?: string[];
  defaultOrderBy?: any;
  include?: any;
  /** When true, listing is public; otherwise it requires an authenticated principal. */
  publicRead?: boolean;
}

const listQuerySchema = paginationSchema.extend({
  q: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/** Builds a CRUD router for a simple admin master table. */
export function crudRouter(opts: CrudOptions): Router {
  const router = Router();
  const delegate = (prisma as unknown as Record<string, Delegate>)[opts.model];
  if (!delegate) throw new Error(`Unknown Prisma model: ${opts.model}`);

  const buildWhere = (req: Request) => {
    const query = getValidatedQuery<z.infer<typeof listQuerySchema> & Record<string, unknown>>(req);
    const where: Record<string, unknown> = {};
    if (query.q && opts.searchFields?.length) {
      where.OR = opts.searchFields.map((f) => ({
        [f]: { contains: query.q, mode: 'insensitive' },
      }));
    }
    if (query.isActive !== undefined) where.isActive = query.isActive;
    for (const f of opts.filterFields ?? []) {
      const raw = (req.query as Record<string, unknown>)[f];
      if (raw !== undefined) where[f] = isNaN(Number(raw)) ? raw : Number(raw);
    }
    return where;
  };

  const readGuard = opts.publicRead ? [] : [authenticate('user', 'admin')];

  // LIST
  router.get(
    '/',
    ...readGuard,
    validate({ query: listQuerySchema }),
    asyncHandler(async (req, res) => {
      const query = getValidatedQuery<z.infer<typeof listQuerySchema>>(req);
      const where = buildWhere(req);
      const [items, total] = await Promise.all([
        delegate.findMany({
          where,
          include: opts.include,
          orderBy: opts.defaultOrderBy ?? { id: 'asc' },
          ...toPrismaPagination(query),
        }),
        delegate.count({ where }),
      ]);
      paginated(res, items, buildMeta(query.page, query.pageSize, total));
    }),
  );

  // GET ONE
  router.get(
    '/:id',
    ...readGuard,
    asyncHandler(async (req, res) => {
      const item = await delegate.findUnique({
        where: { id: Number(req.params.id) },
        include: opts.include,
      });
      if (!item) throw ApiError.notFound();
      ok(res, item);
    }),
  );

  // CREATE (admin only)
  router.post(
    '/',
    authenticate('admin'),
    validate({ body: opts.createSchema }),
    asyncHandler(async (req, res) => {
      const item = await delegate.create({ data: req.body, include: opts.include });
      ok(res, item, 201);
    }),
  );

  // UPDATE (admin only)
  router.patch(
    '/:id',
    authenticate('admin'),
    validate({ body: opts.updateSchema }),
    asyncHandler(async (req, res) => {
      const item = await delegate.update({
        where: { id: Number(req.params.id) },
        data: req.body,
        include: opts.include,
      });
      ok(res, item);
    }),
  );

  // DELETE (admin only)
  router.delete(
    '/:id',
    authenticate('admin'),
    asyncHandler(async (req, res) => {
      await delegate.delete({ where: { id: Number(req.params.id) } });
      ok(res, { id: Number(req.params.id), deleted: true });
    }),
  );

  return router;
}

export { listQuerySchema };
