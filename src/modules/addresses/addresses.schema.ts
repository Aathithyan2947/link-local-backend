import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination.js';

export const createAddressSchema = z.object({
  cityId: z.number().int(),
  areaId: z.number().int().optional(),
  areaName: z.string().optional(),
  pincode: z.string().optional(),
  suburb: z.string().optional(),
  flatWing: z.string().optional(),
  apartment: z.string().optional(),
  lane1: z.string().optional(),
  lane2: z.string().optional(),
  fullAddress: z.string().min(1),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// Address Capture list — status is the address's active flag.
export const listAddressesSchema = paginationSchema.extend({
  q: z.string().optional(),
  status: z.enum(['active', 'inactive', 'all']).optional(),
});

// Address-proof review queue — status is the document's verification state.
export const listAddressDocsSchema = paginationSchema.extend({
  q: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
});

export const reviewDocSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});

export const cityFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        fieldKey: z.string().min(1),
        label: z.string().min(1),
        isRequired: z.boolean().optional(),
        isVisible: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
