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

// Nearby Address Master lookup — maps the user's GPS pin to the closest approved locality.
export const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).optional(),
});

// Address Master list — status is the locality's approval state.
export const listMasterSchema = paginationSchema.extend({
  q: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
});

export const reviewMasterSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

const masterFields = {
  cityId: z.number().int(),
  complex: z.string().optional(),
  lane1: z.string().optional(),
  lane2: z.string().optional(),
  area: z.string().optional(),
  suburb: z.string().optional(),
  pincode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
};

export const createMasterSchema = z.object(masterFields);
export const updateMasterSchema = z.object({
  cityId: z.number().int().optional(),
  complex: z.string().optional(),
  lane1: z.string().optional(),
  lane2: z.string().optional(),
  area: z.string().optional(),
  suburb: z.string().optional(),
  pincode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

// Address-proof review queue — status is the document's verification state.
export const listAddressDocsSchema = paginationSchema.extend({
  q: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
});

export const reviewDocSchema = z.object({
  status: z.enum(['approved', 'rejected']),
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
export type CreateMasterInput = z.infer<typeof createMasterSchema>;
export type UpdateMasterInput = z.infer<typeof updateMasterSchema>;
