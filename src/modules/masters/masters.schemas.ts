import { z } from 'zod';

const partial = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial();

export const citySchema = z.object({
  name: z.string().min(1),
  state: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const areaSchema = z.object({
  cityId: z.number().int(),
  pincode: z.string().optional(),
  suburb: z.string().optional(),
  areaName: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const serviceCategorySchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const serviceSubcategorySchema = z.object({
  categoryId: z.number().int(),
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const subcategoryFieldSchema = z.object({
  subcategoryId: z.number().int(),
  fieldName: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'date', 'dropdown', 'boolean']),
  fieldOptions: z.string().optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const educationSchema = z.object({
  degree: z.string().optional(),
  schoolName: z.string().optional(),
  schoolCity: z.string().optional(),
  collegeName: z.string().optional(),
  collegeCity: z.string().optional(),
  postGradCollege: z.string().optional(),
  postGradCity: z.string().optional(),
});

export const professionSchema = z.object({
  category: z.string().min(1),
});

export const hobbySchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const profileTagSchema = z.object({
  tagName: z.string().min(1),
});

export const referralSourceSchema = z.object({
  source: z.string().min(1),
  label: z.string().optional(),
});

export const docTypeSchema = z.object({
  cityId: z.number().int(),
  docType: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const couponSchema = z.object({
  code: z.string().min(1),
  discountType: z.enum(['amount_off', 'percent_off']),
  discountValue: z.number().positive(),
  validityFrom: z.coerce.date().optional(),
  validityTo: z.coerce.date().optional(),
  maxUses: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
});

export const freebieSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  pointsRequired: z.number().int().nonnegative(),
  isActive: z.boolean().optional(),
});

export const permissionSchema = z.object({
  userType: z.enum(['resident', 'service_provider']),
  action: z.string().min(1),
  isAllowed: z.boolean().optional(),
});

// Partial (update) variants
export const cityUpdate = partial(citySchema.shape);
export const areaUpdate = partial(areaSchema.shape);
export const serviceCategoryUpdate = partial(serviceCategorySchema.shape);
export const serviceSubcategoryUpdate = partial(serviceSubcategorySchema.shape);
export const subcategoryFieldUpdate = partial(subcategoryFieldSchema.shape);
export const educationUpdate = partial(educationSchema.shape);
export const professionUpdate = partial(professionSchema.shape);
export const hobbyUpdate = partial(hobbySchema.shape);
export const profileTagUpdate = partial(profileTagSchema.shape);
export const referralSourceUpdate = partial(referralSourceSchema.shape);
export const docTypeUpdate = partial(docTypeSchema.shape);
export const couponUpdate = partial(couponSchema.shape);
export const freebieUpdate = partial(freebieSchema.shape);
export const permissionUpdate = partial(permissionSchema.shape);
