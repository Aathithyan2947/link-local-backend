import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { validate, getValidatedQuery } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/http.js';
import { reverseSchema } from './geo.schema.js';
import * as service from './geo.service.js';

export const geoRouter = Router();

/**
 * Geocoding is billed per call, so this sits far below the app-wide limiter.
 * Keyed on the member rather than the IP: a shared office or campus NAT should
 * not throttle everyone because one person is dragging a pin around.
 */
const geoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.auth?.sub ?? 'anonymous'),
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

export default geoRouter;
