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

// Latitude / Longitude are mandatory for a master locality — they power the app's 2 km
// nearby-autofill, so a locality without coordinates is unusable.
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// Every locality field is mandatory in the admin "Add locality" form — a curated master
// entry must be complete. (The per-city Form Format only governs the app's address form.)
const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

const masterTextFields = {
  complex: requiredText('Complex / Building name'),
  lane1: requiredText('Lane 1'),
  lane2: requiredText('Lane 2'),
  area: requiredText('Area'),
  suburb: requiredText('Suburb'),
  pincode: requiredText('Pincode'),
};

export const createMasterSchema = z.object({
  cityId: z.number().int(),
  ...masterTextFields,
  latitude,
  longitude,
});
export const updateMasterSchema = z.object({
  cityId: z.number().int().optional(),
  ...masterTextFields,
  latitude,
  longitude,
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
