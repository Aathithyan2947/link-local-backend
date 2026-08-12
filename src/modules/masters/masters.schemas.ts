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
  type: z.enum(['menu', 'date']).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const subcategoryFieldSchema = z.object({
  subcategoryId: z.number().int(),
  fieldName: z.string().min(1),
  // 'file' lets a subcategory require an upload such as a menu card / rate card.
  // 'image' is the same upload flow but renders a picker + thumbnail preview (photos only).
  // 'menu' and 'booking' are FEATURE MARKERS, not questions: they signal that the
  // subcategory uses the product/menu feature or date-based slot booking, and render in the
  // app as a link into that editor. Configure them under the 'service_type' category.
  // 'date' is an ordinary date question (renders a picker) — it is NOT the booking marker.
  // 'pincode' lets the SP pick one or more serviceable areas from the Area master
  // (searchable by area name or pincode); the app stores a JSON array of Area IDs.
  fieldType: z.enum(['text', 'number', 'date', 'dropdown', 'boolean', 'file', 'image', 'menu', 'booking', 'pincode']),
  fieldOptions: z.string().optional(),
  category: z.enum(['basic_details', 'travel', 'payment', 'service_type', 'delivery']),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  // Conditional visibility: only shown to the SP when the field `dependsOnFieldId` currently
  // holds the value `dependsOnValue`. Leave both unset for "always show" (the default).
  dependsOnFieldId: z.number().int().nullable().optional(),
  dependsOnValue: z.string().nullable().optional(),
});

export const educationSchema = z.object({
  degree: z.string().optional(),
  schoolName: z.string().optional(),
  schoolCity: z.string().optional(),
  collegeName: z.string().optional(),
  collegeCity: z.string().optional(),
  university: z.string().optional(),
  postGradCollege: z.string().optional(),
  postGradCity: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const professionSchema = z.object({
  category: z.string().min(1),
  isActive: z.boolean().optional(),
});

export const schoolSchema = z.object({
  name: z.string().min(1),
  city: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const collegeSchema = z.object({
  name: z.string().min(1),
  city: z.string().optional(),
  isActive: z.boolean().optional(),
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
/// Bulk re-sequencing from the admin's drag-and-drop ordering. One call rather than N
/// PATCHes so a failure can't leave the list half-ordered.
export const subcategoryFieldReorderSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int().min(0) })).min(1),
});

export const subcategoryFieldUpdate = partial(subcategoryFieldSchema.shape);
export const educationUpdate = partial(educationSchema.shape);
export const professionUpdate = partial(professionSchema.shape);
export const schoolUpdate = partial(schoolSchema.shape);
export const collegeUpdate = partial(collegeSchema.shape);
export const hobbyUpdate = partial(hobbySchema.shape);
export const profileTagUpdate = partial(profileTagSchema.shape);
export const referralSourceUpdate = partial(referralSourceSchema.shape);
export const docTypeUpdate = partial(docTypeSchema.shape);
export const couponUpdate = partial(couponSchema.shape);
export const freebieUpdate = partial(freebieSchema.shape);
export const permissionUpdate = partial(permissionSchema.shape);
