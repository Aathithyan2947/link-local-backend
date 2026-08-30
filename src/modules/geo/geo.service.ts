import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Cache grid, in decimal places. 4 dp is roughly an 11 m cell: two pins that
 * round into the same cell always resolve to the same street address, so the
 * rounding costs nothing and collapses most repeat lookups into a cache hit.
 */
const CACHE_PRECISION = 4;
const CACHE_TTL_DAYS = 90;
const PROVIDER = 'google';
const GOOGLE_TIMEOUT_MS = 8_000;

/**
 * Without this filter Google happily answers with plus-codes and bare road
 * segments, neither of which can populate an address form.
 */
const RESULT_TYPES = [
  'street_address',
  'premise',
  'subpremise',
  'neighborhood',
  'sublocality',
  'postal_code',
].join('|');

/**
 * A `route` that is really a through-road is a poor guess at someone's lane.
 * Mirrors the guard the app already applied to its previous geocoder.
 */
const THROUGH_ROAD = /flyover|highway|expressway|bridge|f\.?o\.?b/i;

/** Mirrors the app's `GeoAddress`. */
export interface GeoAddress {
  latitude: number;
  longitude: number;
  fullAddress: string | null;
  lane1: string | null;
  locality: string | null;
  area: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  googlePlaceId: string | null;
}

/** Coordinates are the caller's, so only the resolved text is worth caching. */
type CachedAddress = Omit<GeoAddress, 'latitude' | 'longitude'>;

interface GoogleComponent {
  long_name: string;
  types: string[];
}

interface GoogleResult {
  formatted_address?: string;
  place_id?: string;
  address_components?: GoogleComponent[];
}

const gridKey = (value: number) => Number(value.toFixed(CACHE_PRECISION));

const withCoords = (lat: number, lng: number, a: CachedAddress): GeoAddress => ({
  latitude: lat,
  longitude: lng,
  ...a,
});

const empty: CachedAddress = {
  fullAddress: null,
  lane1: null,
  locality: null,
  area: null,
  suburb: null,
  city: null,
  state: null,
  pincode: null,
  googlePlaceId: null,
};

/**
 * First component carrying any of `types`, scanning results most-specific-first
 * so a precise result wins but a coarser one can still supply what it omitted
 * (a premise result often has no postal_code, for instance).
 */
function pick(results: GoogleResult[], ...types: string[]): string | null {
  for (const result of results) {
    for (const component of result.address_components ?? []) {
      if (component.types.some((t) => types.includes(t))) return component.long_name;
    }
  }
  return null;
}

/** Folds Google's component list into the shape the app's address form expects. */
function toAddress(results: GoogleResult[]): CachedAddress {
  const route = pick(results, 'route');

  // Google's Indian sublocality hierarchy, fine → coarse. Note that every
  // sublocality component also carries the bare `sublocality` type, so matching
  // on it would silently return the finest level regardless of which level was
  // asked for — hence the explicit levels only.
  const neighbourhood = pick(results, 'sublocality_level_2', 'neighborhood', 'sublocality_level_3');
  const suburb = pick(results, 'sublocality_level_1');
  // Prefer a true neighbourhood as the "area", falling back to the suburb.
  const area = neighbourhood ?? suburb;

  return {
    fullAddress: results[0]?.formatted_address ?? null,
    lane1: route && !THROUGH_ROAD.test(route) ? route : null,
    locality: neighbourhood,
    area,
    // Compared against the area actually chosen, not the neighbourhood: when
    // there is no neighbourhood the suburb becomes the area, and would
    // otherwise be filled into both fields.
    suburb: suburb !== area ? suburb : null,
    city: pick(results, 'locality', 'administrative_area_level_3'),
    state: pick(results, 'administrative_area_level_1'),
    pincode: pick(results, 'postal_code'),
    googlePlaceId: results[0]?.place_id ?? null,
  };
}

/**
 * Today's cache-row count doubles as the billed-call counter: a cache hit is
 * never billed, so every billed call writes or refreshes exactly one row.
 * Durable across restarts, which an in-memory counter would not be on a host
 * that sleeps when idle.
 */
async function isOverDailyLimit(): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const used = await prisma.geocodeCache.count({ where: { createdAt: { gte: startOfDay } } });
  return used >= env.GEO_DAILY_LIMIT;
}

/**
 * Resolves a map pin to an address, preferring the cache.
 *
 * Never throws: an address flow that dead-ends because a third party is down is
 * worse than one that falls back to bare coordinates, which is exactly what the
 * app already does when a lookup fails.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoAddress> {
  const latKey = gridKey(lat);
  const lngKey = gridKey(lng);
  const key = { latKey_lngKey_provider: { latKey, lngKey, provider: PROVIDER } };

  const cached = await prisma.geocodeCache.findUnique({ where: key });
  if (cached && cached.expiresAt > new Date()) {
    return withCoords(lat, lng, cached.payload as unknown as CachedAddress);
  }

  // An expired entry still beats nothing when we cannot call out below.
  const fallback = withCoords(
    lat,
    lng,
    cached ? (cached.payload as unknown as CachedAddress) : empty,
  );

  const apiKey = env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    logger.warn('GOOGLE_MAPS_SERVER_KEY is unset — reverse geocoding is serving cache only');
    return fallback;
  }
  if (await isOverDailyLimit()) {
    logger.warn({ limit: env.GEO_DAILY_LIMIT }, 'Daily geocode limit reached — serving cache only');
    return fallback;
  }

  let results: GoogleResult[];
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('result_type', RESULT_TYPES);
    url.searchParams.set('region', env.GEO_REGION);
    url.searchParams.set('language', 'en');
    url.searchParams.set('key', apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
    const body = (await response.json()) as {
      status: string;
      error_message?: string;
      results?: GoogleResult[];
    };

    if (body.status === 'ZERO_RESULTS') {
      results = [];
    } else if (body.status !== 'OK') {
      // REQUEST_DENIED and OVER_QUERY_LIMIT are billing or key-restriction
      // problems, not member problems: loud in the logs, quiet in the app.
      logger.error(
        { status: body.status, error: body.error_message },
        'Google geocoding rejected the request',
      );
      return fallback;
    } else {
      results = body.results ?? [];
    }
  } catch (err) {
    logger.error({ err }, 'Google geocoding call failed');
    return fallback;
  }

  const address = toAddress(results);
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86_400_000);

  // createdAt is refreshed on update so the daily counter above sees this as
  // the billed call it was.
  await prisma.geocodeCache
    .upsert({
      where: key,
      create: { latKey, lngKey, provider: PROVIDER, payload: address, expiresAt },
      update: { payload: address, expiresAt, createdAt: new Date() },
    })
    .catch((err) => logger.warn({ err }, 'Could not cache the geocode result'));

  return withCoords(lat, lng, address);
}
