import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination.js';
import { LOCALITY_LIMITS, localityText, pincode } from '../../lib/localityText.js';

// The member's own address. Its locality parts are optional (the city's form decides which
// appear) but held to the same rules as the Address Master, which they feed.
export const createAddressSchema = z.object({
  cityId: z.number().int(),
  areaId: z.number().int().optional(),
  areaName: localityText('Area', LOCALITY_LIMITS.text).optional(),
  pincode: pincode().optional(),
  suburb: localityText('Suburb', LOCALITY_LIMITS.text).optional(),
  flatWing: z.string().trim().max(40, 'Flat / wing must be at most 40 characters').optional(),
  apartment: localityText('Building / complex name', LOCALITY_LIMITS.complex).optional(),
  lane1: localityText('Lane 1', LOCALITY_LIMITS.text).optional(),
  lane2: localityText('Lane 2', LOCALITY_LIMITS.text).optional(),
  fullAddress: z.string().min(1).max(600),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  // How the pin was captured — see Address.accuracyM in the Prisma schema for why
  // this is worth storing. Null accuracy is meaningful: a hand-placed pin is a
  // placement, not a measurement.
  accuracyM: z.number().nonnegative().optional(),
  locationSource: z.enum(['gps', 'cached', 'manual_pin', 'master', 'place', 'mocked']).optional(),
  googlePlaceId: z.string().optional(),
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
// entry must be complete — and held to the shared locality rules (length, characters).
// (The per-city Form Format only governs the app's address form.)
const masterTextFields = {
  complex: localityText('Complex / Building name', LOCALITY_LIMITS.complex),
  lane1: localityText('Lane 1', LOCALITY_LIMITS.text),
  lane2: localityText('Lane 2', LOCALITY_LIMITS.text),
  area: localityText('Area', LOCALITY_LIMITS.text),
  suburb: localityText('Suburb', LOCALITY_LIMITS.text),
  pincode: pincode(),
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
