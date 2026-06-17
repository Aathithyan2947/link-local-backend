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
});

export const educationSchema = z.object({
  educationMasterId: z.number().int().optional(),
  degree: z.string().optional(),
  schoolName: z.string().optional(),
  schoolCity: z.string().optional(),
  collegeName: z.string().optional(),
  collegeCity: z.string().optional(),
  postGradCollege: z.string().optional(),
  postGradCity: z.string().optional(),
});

export const professionSchema = z.object({
  professionMasterId: z.number().int().optional(),
  category: z.string().optional(), // self-add if no id
  companyOrDetail: z.string().optional(),
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

export const serviceTypesSchema = z.object({
  subcategoryIds: z.array(z.number().int()).default([]),
  // Free-text "Other" services to flag for admin approval. categoryId is optional — when
  // omitted (a single global "Other"), it's filed under a fallback "Other" category.
  customServices: z
    .array(z.object({ categoryId: z.number().int().optional(), name: z.string().min(1) }))
    .optional(),
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
