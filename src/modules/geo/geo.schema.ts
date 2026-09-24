import { z } from 'zod';

export const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/**
 * Google's session token: URL-safe base64, at most 36 characters. A UUID fits.
 * It groups a run of keystrokes plus the final details call into one billed session.
 */
const sessionToken = z.string().regex(/^[A-Za-z0-9_-]{1,36}$/);

export const autocompleteSchema = z.object({
  q: z.string().trim().min(3).max(120),
  sessionToken,
  // Results are restricted to this city's service area (or biased to its centre
  // when it has none).
  cityId: z.coerce.number().int().positive(),
});

export const placeSchema = z.object({
  // Place IDs are opaque but URL-safe; the pattern keeps them from steering the upstream path.
  placeId: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/),
  sessionToken: sessionToken.optional(),
});
