import { Router } from 'express';
import { z } from 'zod';
import { crudRouter } from './crud.factory.js';
import * as s from './masters.schemas.js';
import { ensureCityOtherDocType, deleteCity } from '../addresses/addresses.service.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate, requireAdminRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Mounts all admin "master data" tables under /masters.
 * Reads are public (the mobile app needs categories, cities, etc.);
 * writes require an admin token (enforced inside crudRouter).
 */
export const mastersRouter = Router();

// Custom city delete (registered before the CRUD mount so it overrides the generic delete):
// clears admin config rows and blocks gracefully when real data is linked.
mastersRouter.delete(
  '/cities/:id',
  authenticate('admin'),
  requireAdminRole('super_admin'),
  asyncHandler(async (req, res) => {
    ok(res, await deleteCity(Number(req.params.id)));
  }),
);

// Custom service-category delete: blocked while it still has sub-categories (avoids an
// unhandled FK error / silent failure). Registered before the CRUD mount so it overrides it.
mastersRouter.delete(
  '/service-categories/:id',
  authenticate('admin'),
  requireAdminRole('super_admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cat = await prisma.serviceCategory.findUnique({ where: { id } });
    if (!cat) throw ApiError.notFound('Category not found');
    const subCount = await prisma.serviceSubcategory.count({ where: { categoryId: id } });
    if (subCount > 0) {
      throw ApiError.conflict("Delete or move this category's sub-categories before deleting it.");
    }
    await prisma.serviceCategory.delete({ where: { id } });
    ok(res, { id, deleted: true });
  }),
);

// Custom service-subcategory delete: cascade its onboarding fields (+ SP answers) and SP
// selections in one transaction, then remove the sub-category. Overrides the generic delete,
// which would otherwise fail with an FK error and leave the row in the list.
mastersRouter.delete(
  '/service-subcategories/:id',
  authenticate('admin'),
  requireAdminRole('super_admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const sub = await prisma.serviceSubcategory.findUnique({ where: { id } });
    if (!sub) throw ApiError.notFound('Sub-category not found');
    await prisma.$transaction(async (tx) => {
      await tx.spProfileCustomField.deleteMany({ where: { field: { subcategoryId: id } } });
      await tx.serviceSubcategoryField.deleteMany({ where: { subcategoryId: id } });
      await tx.profileServiceType.deleteMany({ where: { subcategoryId: id } });
      await tx.serviceSubcategory.delete({ where: { id } });
    });
    ok(res, { id, deleted: true });
  }),
);

mastersRouter.use(
  '/cities',
  crudRouter({
    model: 'city',
    createSchema: s.citySchema,
    updateSchema: s.cityUpdate,
    searchFields: ['name', 'state'],
    defaultOrderBy: { name: 'asc' },
    publicRead: true,
    // Every new city gets the "Other" document type enabled by default.
    afterCreate: (city: { id: number }) => ensureCityOtherDocType(city.id),
  }),
);

mastersRouter.use(
  '/areas',
  crudRouter({
    model: 'area',
    createSchema: s.areaSchema,
    updateSchema: s.areaUpdate,
    searchFields: ['areaName', 'suburb', 'pincode'],
    filterFields: ['cityId'],
    defaultOrderBy: { areaName: 'asc' },
    include: { city: { select: { id: true, name: true } } },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/service-categories',
  crudRouter({
    model: 'serviceCategory',
    createSchema: s.serviceCategorySchema,
    updateSchema: s.serviceCategoryUpdate,
    searchFields: ['name'],
    defaultOrderBy: { name: 'asc' },
    include: { subcategories: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/service-subcategories',
  crudRouter({
    model: 'serviceSubcategory',
    createSchema: s.serviceSubcategorySchema,
    updateSchema: s.serviceSubcategoryUpdate,
    searchFields: ['name'],
    filterFields: ['categoryId'],
    defaultOrderBy: { name: 'asc' },
    include: { category: { select: { id: true, name: true } } },
    publicRead: true,
  }),
);

// Prefill: copy a sub-category's onboarding fields onto another (e.g. seed a new
// "Nail Art Specialist" from "Hair Stylist"). Fields the target already has (matched by
// name, case-insensitive) are skipped so it never creates duplicates. Registered before the
// CRUD mount so it isn't shadowed by it.
mastersRouter.post(
  '/subcategory-fields/copy',
  authenticate('admin'),
  requireAdminRole('super_admin'),
  validate({ body: z.object({ fromSubcategoryId: z.number().int(), toSubcategoryId: z.number().int() }) }),
  asyncHandler(async (req, res) => {
    const { fromSubcategoryId, toSubcategoryId } = req.body as {
      fromSubcategoryId: number;
      toSubcategoryId: number;
    };
    const source = await prisma.serviceSubcategoryField.findMany({
      where: { subcategoryId: fromSubcategoryId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const existing = await prisma.serviceSubcategoryField.findMany({
      where: { subcategoryId: toSubcategoryId },
      select: { fieldName: true },
    });
    const have = new Set(existing.map((e) => e.fieldName.trim().toLowerCase()));
    const toCreate = source.filter((f) => !have.has(f.fieldName.trim().toLowerCase()));
    if (toCreate.length) {
      await prisma.serviceSubcategoryField.createMany({
        data: toCreate.map((f) => ({
          subcategoryId: toSubcategoryId,
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          fieldOptions: f.fieldOptions,
          isRequired: f.isRequired,
          sortOrder: f.sortOrder,
          isActive: f.isActive,
        })),
      });
    }
    ok(res, { copied: toCreate.length, skipped: source.length - toCreate.length }, 201);
  }),
);

mastersRouter.use(
  '/subcategory-fields',
  crudRouter({
    model: 'serviceSubcategoryField',
    createSchema: s.subcategoryFieldSchema,
    updateSchema: s.subcategoryFieldUpdate,
    searchFields: ['fieldName'],
    filterFields: ['subcategoryId'],
    defaultOrderBy: { sortOrder: 'asc' },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/education',
  crudRouter({
    model: 'educationMaster',
    createSchema: s.educationSchema,
    updateSchema: s.educationUpdate,
    searchFields: ['degree', 'collegeName', 'schoolName'],
    publicRead: true,
  }),
);

mastersRouter.use(
  '/professions',
  crudRouter({
    model: 'professionMaster',
    createSchema: s.professionSchema,
    updateSchema: s.professionUpdate,
    searchFields: ['category'],
    publicRead: true,
  }),
);

mastersRouter.use(
  '/schools',
  crudRouter({
    model: 'schoolMaster',
    createSchema: s.schoolSchema,
    updateSchema: s.schoolUpdate,
    searchFields: ['name', 'city'],
    defaultOrderBy: { name: 'asc' },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/colleges',
  crudRouter({
    model: 'collegeMaster',
    createSchema: s.collegeSchema,
    updateSchema: s.collegeUpdate,
    searchFields: ['name', 'city'],
    defaultOrderBy: { name: 'asc' },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/hobbies',
  crudRouter({
    model: 'hobbiesMaster',
    createSchema: s.hobbySchema,
    updateSchema: s.hobbyUpdate,
    searchFields: ['name'],
    defaultOrderBy: { name: 'asc' },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/profile-tags',
  crudRouter({
    model: 'profileTag',
    createSchema: s.profileTagSchema,
    updateSchema: s.profileTagUpdate,
    searchFields: ['tagName'],
  }),
);

mastersRouter.use(
  '/referral-sources',
  crudRouter({
    model: 'referralSource',
    createSchema: s.referralSourceSchema,
    updateSchema: s.referralSourceUpdate,
    searchFields: ['source', 'label'],
    publicRead: true,
  }),
);

mastersRouter.use(
  '/doc-types',
  crudRouter({
    model: 'cityAllowedDocType',
    createSchema: s.docTypeSchema,
    updateSchema: s.docTypeUpdate,
    searchFields: ['docType'],
    filterFields: ['cityId'],
    include: { city: { select: { id: true, name: true } } },
    publicRead: true,
  }),
);

mastersRouter.use(
  '/coupons',
  crudRouter({
    model: 'couponCode',
    createSchema: s.couponSchema,
    updateSchema: s.couponUpdate,
    searchFields: ['code'],
    defaultOrderBy: { createdAt: 'desc' },
  }),
);

mastersRouter.use(
  '/freebies',
  crudRouter({
    model: 'freebie',
    createSchema: s.freebieSchema,
    updateSchema: s.freebieUpdate,
    searchFields: ['name'],
  }),
);

mastersRouter.use(
  '/permissions',
  crudRouter({
    model: 'permissionMaster',
    createSchema: s.permissionSchema,
    updateSchema: s.permissionUpdate,
    searchFields: ['action'],
    filterFields: ['userType'],
  }),
);
