import { Router } from 'express';
import { crudRouter } from './crud.factory.js';
import * as s from './masters.schemas.js';

/**
 * Mounts all admin "master data" tables under /masters.
 * Reads are public (the mobile app needs categories, cities, etc.);
 * writes require an admin token (enforced inside crudRouter).
 */
export const mastersRouter = Router();

mastersRouter.use(
  '/cities',
  crudRouter({
    model: 'city',
    createSchema: s.citySchema,
    updateSchema: s.cityUpdate,
    searchFields: ['name', 'state'],
    defaultOrderBy: { name: 'asc' },
    publicRead: true,
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
