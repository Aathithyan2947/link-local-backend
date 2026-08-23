import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['male', 'female', 'do_not_disclose']).optional(),
  aboutMe: z.string().max(2000).optional(),
  ownershipType: z.enum(['owned', 'rented']).optional(),
  residingSince: z.coerce.date().optional(),
  yearsOfExperience: z.number().int().min(0).max(80).optional(),
  socialMediaShareEnabled: z.boolean().optional(),
  canOfferHelpWith: z.string().max(1000).optional(),
  // Public contact details — NOT the sign-in credentials. Empty string clears them; no
  // uniqueness or verification, since the SP may legitimately publish their personal number.
  servicePhone: z.string().max(20).optional(),
  serviceEmail: z.string().max(120).optional(),
});

export const educationSchema = z.object({
  educationMasterId: z.number().int().optional(),
  degree: z.string().optional(),
  schoolName: z.string().optional(),
  schoolCity: z.string().optional(),
  collegeName: z.string().optional(),
  collegeCity: z.string().optional(),
  university: z.string().optional(),
  postGradCollege: z.string().optional(),
  postGradCity: z.string().optional(),
});

export const professionSchema = z.object({
  professionMasterId: z.number().int().optional(),
  category: z.string().optional(), // self-add if no id
  companyOrDetail: z.string().optional(),
});

/** Replace-all form of [professionSchema], for callers that own the whole set (the SP wizard). */
export const professionsSchema = z.object({
  professions: z.array(professionSchema),
});

export const hobbySchema = z.object({
  hobbyMasterId: z.number().int().optional(),
  customHobby: z.string().max(60).optional(),
});

export const familySchema = z.object({
  relation: z.string().min(1),
  relatedUserId: z.number().int().optional(),
  name: z.string().max(120).optional(),
});

export const petSchema = z.object({
  name: z.string().max(60).optional(),
  type: z.string().max(60).optional(),
  breed: z.string().max(60).optional(),
  age: z.number().int().min(0).max(100).optional(),
  photoUrl: z.string().optional(),
  videoUrl: z.string().optional(),
});

export const contactSchema = z.object({
  contactType: z.enum(['phone', 'whatsapp', 'email', 'other']),
  value: z.string().min(1),
  visibilityCircleId: z.number().int().optional(),
});

// SP answers to a subcategory's dynamic fields. `value` holds text, or an uploaded file URL
// for 'file' fields (menu card / rate card).
export const customFieldsSchema = z.object({
  values: z.array(z.object({ fieldId: z.number().int(), value: z.string() })).default([]),
});

export const serviceTypesSchema = z.object({
  subcategoryIds: z.array(z.number().int()).default([]),
  // Free-text "Other" services to flag for admin approval. categoryId is optional — when
  // omitted (a single global "Other"), it's filed under a fallback "Other" category.
  customServices: z
    .array(z.object({ categoryId: z.number().int().optional(), name: z.string().min(1) }))
    .optional(),
});

/// One customization the SP offers on a product. `toggle` is a yes/no option; `text` adds a
/// free-text box for the resident to fill in (what the old "Custom message" checkbox did).
export const productCustomizationSchema = z.object({
  label: z.string().min(1).max(60),
  inputType: z.enum(['toggle', 'text']).default('toggle'),
  isRequired: z.boolean().optional(),
});

export const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative().optional(),
  unit: z.string().optional(),
  quantity: z.number().optional(),
  quantityMetric: z.string().optional(),
  customizationNotes: z.string().optional(),
  photoUrl: z.string().optional(),
  category: z.string().optional(),
  isAvailable: z.boolean().optional(),
  // Replace-all when present, like rates/professions. Capped so the resident's product
  // screen stays usable. Omit the key to leave existing customizations untouched.
  customizations: z.array(productCustomizationSchema).max(10).optional(),
});

export const deliverySchema = z.object({
  deliveryTimingType: z.enum(['after_24h', 'after_48h', 'after_confirmation']).optional(),
  offersHomeDelivery: z.boolean().optional(),
  deliveryRadiusKm: z.number().optional(),
  minOrderAmount: z.number().optional(),
  deliveryCharge: z.number().optional(),
  deliveryTimeMinutes: z.number().int().optional(),
  offersPickup: z.boolean().optional(),
  deliveryNotes: z.string().optional(),
  packagingCharge: z.number().nonnegative().optional(),
  freeDeliveryThreshold: z.number().nonnegative().optional(),
  orderLeadTimeHours: z.number().int().nonnegative().optional(),
});

// Service SP charges — the resident picks one when booking (per session / monthly / hourly).
export const ratesSchema = z.object({
  rates: z
    .array(
      z.object({
        rateType: z.enum(['per_session', 'monthly', 'hourly']),
        amount: z.number().nonnegative(),
      }),
    )
    .default([]),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)');

export const availabilitySchema = z
  .object({
    workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
    startTime: hhmm,
    endTime: hhmm,
    slotMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
    willingToTravel: z.boolean().optional(),
    maxTravelKm: z.number().nonnegative().optional(),
    horizonDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => v.endTime > v.startTime, { message: 'End time must be after start time', path: ['endTime'] });

export const blackoutSchema = z.object({
  unavailableDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  reason: z.enum(['holiday', 'personal', 'other']).optional(),
});

export const paymentTermsSchema = z.object({
  paymentTerms: z.enum(['full_advance', 'partial_advance', 'on_delivery']),
  partialAdvancePct: z.number().min(0).max(100).optional(),
});

export const paymentMethodSchema = z.object({
  paymentType: z.enum(['cash', 'upi', 'card', 'net_banking', 'cheque', 'bank_transfer', 'other']),
  upiId: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
});

export const privacySchema = z.object({
  showCallButton: z.boolean(),
});

export const visibilitySchema = z.object({
  profileVisibility: z.enum(['all', 'area', 'apartment', 'only_me']).optional(),
  contactVisibility: z.enum(['all', 'area', 'apartment', 'only_me', 'has_ordered']).optional(),
});

export const notificationPrefsSchema = z.object({
  notifyApp: z.boolean().optional(),
  notifyWhatsapp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  alertMessages: z.boolean().optional(),
  alertOrders: z.boolean().optional(),
  alertPayments: z.boolean().optional(),
});

export const updateEmailSchema = z.object({
  email: z.string().email().nullable(),
});

export const updatePhoneSchema = z.object({
  mobile: z.string().min(6).max(15).nullable(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6).max(72),
});

export const reportProfileSchema = z.object({
  reason: z.string().min(1).max(500),
});
