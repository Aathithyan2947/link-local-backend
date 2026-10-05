import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { autocompleteSchema, placeSchema, reverseSchema } from './geo.schema.js';
import * as service from './geo.service.js';

export const geoRouter = Router();

/**
 * Geocoding is billed per call, so this sits far below the app-wide limiter.
 * Keyed on the member rather than the IP: a shared office or campus NAT should
 * not throttle everyone because one person is dragging a pin around. The principal
 * is part of the key because member and admin ids are separate sequences.
 */
const geoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.auth ? `${req.auth.principal}:${req.auth.sub}` : 'anonymous'),
});

// Reverse-geocode a map pin. Cached server-side; degrades to bare coordinates
// rather than failing when Google is unreachable or the daily cap is hit.
geoRouter.get(
  '/reverse',
  authenticate('user'),
  geoLimiter,
  validate({ query: reverseSchema }),
  asyncHandler(async (req, res) => {
    const { lat, lng } = getValidatedQuery<{ lat: number; lng: number }>(req);
    ok(res, await service.reverseGeocode(lat, lng));
  }),
);

/**
 * Autocomplete fires per keystroke (debounced), so it gets its own, looser
 * limiter; sharing the geocode one would lock a member out mid-sign-up.
 */
const placesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.auth ? `${req.auth.principal}:${req.auth.sub}` : 'anonymous'),
});

// Google place suggestions for typed text. Empty rather than failing when
// Google is unreachable, the key is missing, or the daily cap is hit.
// Admins use it too, to autofill a complex in the Address Master form.
geoRouter.get(
  '/autocomplete',
  authenticate('user', 'admin'),
  placesLimiter,
  validate({ query: autocompleteSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<{ q: string; sessionToken: string; cityId: number }>(req);
    ok(res, await service.autocompletePlaces(query));
  }),
);

// Resolves a picked suggestion to coordinates + address fields. `data` is null
// when the place cannot be resolved; the app then falls back to the map pin.
geoRouter.get(
  '/place',
  authenticate('user', 'admin'),
  placesLimiter,
  validate({ query: placeSchema }),
  asyncHandler(async (req, res) => {
    const { placeId, sessionToken } = getValidatedQuery<{ placeId: string; sessionToken?: string }>(req);
    ok(res, await service.placeDetails(placeId, sessionToken));
  }),
);

export default geoRouter;
