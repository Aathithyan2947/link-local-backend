import { z } from 'zod';

/** Limits for the provider's "Set up your profile" fields — the app enforces the same numbers
 *  (profile_limits.dart) and shows these messages under each field. */
export const PROFILE_LIMITS = {
  name: 100,
  aboutMe: 2000,
  professionTitle: 80,
  yearsOfExperience: 80,
  rateAmount: 1_000_000,
} as const;

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(PROFILE_LIMITS.name, `Name can be at most ${PROFILE_LIMITS.name} characters`)
    .optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['male', 'female', 'do_not_disclose']).optional(),
  aboutMe: z
    .string()
    .max(PROFILE_LIMITS.aboutMe, `About can be at most ${PROFILE_LIMITS.aboutMe} characters`)
    .optional(),
  ownershipType: z.enum(['owned', 'rented']).optional(),
  residingSince: z.coerce.date().optional(),
  yearsOfExperience: z
    .number()
    .int('Years of experience must be a whole number')
    .min(0, `Years of experience must be between 0 and ${PROFILE_LIMITS.yearsOfExperience}`)
    .max(PROFILE_LIMITS.yearsOfExperience, `Years of experience must be between 0 and ${PROFILE_LIMITS.yearsOfExperience}`)
    .optional(),
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
  category: z
    .string()
    .max(PROFILE_LIMITS.professionTitle, `Professional title can be at most ${PROFILE_LIMITS.professionTitle} characters`)
    .optional(), // self-add if no id
  companyOrDetail: z.string().optional(),
});

/**
 * The profile's "About" block edited as one unit: About Me plus the whole education and
 * profession sets, replaced together so a partial save can't leave a mix of old and new.
 */
export const aboutSchema = z.object({
  aboutMe: z.string().max(2000),
  educations: z
    .array(
      z.object({
        degree: z.string().max(200).optional(),
        schoolName: z.string().max(200).optional(),
        collegeName: z.string().max(200).optional(),
      }),
    )
    .max(10),
  professions: z.array(professionSchema).max(10),
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
        amount: z
          .number()
          .positive('Charge must be greater than 0')
          .max(PROFILE_LIMITS.rateAmount, 'Charge can be at most ₹10,00,000'),
      }),
    )
    .default([]),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24h)');

/** How far a service provider may say they travel — a local-services limit (and well inside
 *  the max_travel_km column, DECIMAL(5,2)). The app enforces the same number on the field. */
export const MAX_TRAVEL_KM = 100;

/** Kilometres from a typed distance: a number, optionally followed by "km" / "kms" (older
 *  answers were saved as e.g. "10 km"). Null when it isn't one. */
export function parseTravelKm(value: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:km|kms|kilometers?|kilometres?)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** The problem with a travel distance typed as text (a custom field answer), or null. */
export function travelDistanceError(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  const km = parseTravelKm(t);
  if (km == null || !Number.isFinite(km) || km <= 0) return 'Enter a distance greater than 0';
  if (km > MAX_TRAVEL_KM) return `Maximum travel distance cannot exceed ${MAX_TRAVEL_KM} km`;
  return null;
}

/** Which custom field is the travel distance — the same rule the app's profile page uses to
 *  show "Travels up to N km": a Travel / Service-type field whose name mentions distance. */
export function isTravelDistanceField(f: { category: string; fieldName: string; fieldType: string }): boolean {
  return (f.category === 'travel' || f.category === 'service_type') && f.fieldType !== 'pincode' && /distance/i.test(f.fieldName);
}

export const availabilitySchema = z
  .object({
    workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
    startTime: hhmm,
    endTime: hhmm,
    slotMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
    willingToTravel: z.boolean().optional(),
    maxTravelKm: z
      .number()
      .positive('Enter a distance greater than 0')
      .max(MAX_TRAVEL_KM, `Maximum travel distance cannot exceed ${MAX_TRAVEL_KM} km`)
      .optional(),
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
