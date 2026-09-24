import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { cityArea } from '../../lib/cityArea.js';

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

// ── Place search (typed address → Google Places) ─────────────────────────────
// Used when the curated Address Master has no match for what the member typed.
// Places API (New): https://developers.google.com/maps/documentation/places/web-service/op-overview

const PLACES_BASE = 'https://places.googleapis.com/v1';

/** Bias radius for a city with no service area set. A bias, not a fence. */
const BIAS_RADIUS_M = 30_000;

/** Place details barely change; a day keeps repeat picks free without holding them long. */
const PLACE_CACHE_TTL_MS = 24 * 3_600_000;
const PLACE_CACHE_MAX = 2_000;

/**
 * Types whose coordinates mark a specific building or business. Anything else
 * (a locality, a road) is a centroid, and the app asks the member to check the pin.
 */
const PRECISE_TYPES = new Set([
  'premise',
  'subpremise',
  'street_address',
  'establishment',
  'point_of_interest',
]);

/** Types whose suggestion text is a building or business name, not a street line. */
const NAMED_TYPES = new Set(['premise', 'subpremise', 'establishment', 'point_of_interest']);

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string | null;
}

export interface PlaceAddress extends GeoAddress {
  /** True when the coordinates mark the place itself rather than an area's centre. */
  isPrecise: boolean;
  /** True when the place is a named building or business, so its name can fill the building field. */
  isNamed: boolean;
}

interface PlacesComponent {
  longText?: string;
  types?: string[];
}

interface PlacesDetails {
  id?: string;
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: PlacesComponent[];
  types?: string[];
}

interface PlacesAutocomplete {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      text?: { text: string };
      structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
    };
  }[];
}

/**
 * Autocomplete and details calls are not cache rows, so the geocode counter
 * above cannot see them. In-memory is enough for a guard rail: a restart only
 * ever resets it towards allowing calls, and the per-member limiter still holds.
 */
const placesUsage = { day: '', count: 0 };

function takePlacesQuota(): boolean {
  const today = new Date().toDateString();
  if (placesUsage.day !== today) {
    placesUsage.day = today;
    placesUsage.count = 0;
  }
  if (placesUsage.count >= env.GEO_PLACES_DAILY_LIMIT) return false;
  placesUsage.count += 1;
  return true;
}

const placeCache = new Map<string, { value: PlaceAddress; expiresAt: number }>();
const cityCentres = new Map<number, { latitude: number; longitude: number } | null>();

/**
 * Fallback for a city with no service area: the mean of its approved
 * localities. Stable enough to compute once per process.
 */
async function localitiesCentre(cityId: number) {
  if (cityCentres.has(cityId)) return cityCentres.get(cityId) ?? null;
  const agg = await prisma.addressMaster.aggregate({
    where: { cityId, status: 'approved', latitude: { not: null }, longitude: { not: null } },
    _avg: { latitude: true, longitude: true },
  });
  const centre =
    agg._avg.latitude != null && agg._avg.longitude != null
      ? { latitude: Number(agg._avg.latitude), longitude: Number(agg._avg.longitude) }
      : null;
  cityCentres.set(cityId, centre);
  return centre;
}

/** Shared preconditions for a billed Places call. Returns the key, or null to degrade. */
function placesKey(): string | null {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    logger.warn('GOOGLE_MAPS_SERVER_KEY is unset — place search is disabled');
    return null;
  }
  if (!takePlacesQuota()) {
    logger.warn({ limit: env.GEO_PLACES_DAILY_LIMIT }, 'Daily Places limit reached — place search paused');
    return null;
  }
  return apiKey;
}

/**
 * Suggests Google places for free text inside the member's chosen city: restricted
 * to its service area, or, for a city without one, biased to its localities.
 * The app still checks the picked place's exact position, since a suggestion
 * can pass the restriction while the place itself sits just outside.
 *
 * Never throws: an empty list lets the app fall back to the curated results
 * and the map pin, which is better than an error in the middle of sign-up.
 */
export async function autocompletePlaces(input: {
  q: string;
  sessionToken: string;
  cityId: number;
}): Promise<PlaceSuggestion[]> {
  const city = await prisma.city.findUnique({ where: { id: input.cityId } });
  if (!city) return [];
  const area = cityArea(city);

  const apiKey = placesKey();
  if (!apiKey) return [];

  let placement: Record<string, unknown> = {};
  if (area) {
    const circle = {
      center: { latitude: area.latitude, longitude: area.longitude },
      radius: Math.min(area.radiusKm * 1000, 50_000), // Google's maximum
    };
    placement = { locationRestriction: { circle } };
  } else {
    const centre = await localitiesCentre(input.cityId);
    if (centre) placement = { locationBias: { circle: { center: centre, radius: BIAS_RADIUS_M } } };
  }

  try {
    const response = await fetch(`${PLACES_BASE}/places:autocomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        input: input.q,
        sessionToken: input.sessionToken,
        includedRegionCodes: [env.GEO_REGION],
        languageCode: 'en',
        ...placement,
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const body = (await response.json()) as PlacesAutocomplete & { error?: { message?: string } };
    if (!response.ok) {
      logger.error({ status: response.status, error: body.error?.message }, 'Google autocomplete rejected the request');
      return [];
    }

    return (body.suggestions ?? []).flatMap(({ placePrediction: p }) =>
      p
        ? [
            {
              placeId: p.placeId,
              primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
              secondaryText: p.structuredFormat?.secondaryText?.text ?? null,
            },
          ]
        : [],
    );
  } catch (err) {
    logger.error({ err }, 'Google autocomplete call failed');
    return [];
  }
}

/**
 * Resolves a picked suggestion to coordinates plus the same address fields a
 * map pin produces. Returns null when the place cannot be resolved; the app
 * then asks the member to pin it on the map.
 *
 * Only Essentials-tier fields are requested (no displayName): the app already
 * has the place's name from the suggestion it showed.
 */
export async function placeDetails(placeId: string, sessionToken?: string): Promise<PlaceAddress | null> {
  const cached = placeCache.get(placeId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const apiKey = placesKey();
  if (!apiKey) return null;

  let place: PlacesDetails;
  try {
    const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`);
    url.searchParams.set('languageCode', 'en');
    url.searchParams.set('regionCode', env.GEO_REGION);
    // Closes the autocomplete session so its keystrokes are billed as one.
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);

    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents,types',
      },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const body = (await response.json()) as PlacesDetails & { error?: { message?: string } };
    if (!response.ok) {
      logger.error({ status: response.status, error: body.error?.message }, 'Google place details rejected the request');
      return null;
    }
    place = body;
  } catch (err) {
    logger.error({ err }, 'Google place details call failed');
    return null;
  }

  if (!place.location) return null;

  // Same field mapping as a map pin, so both paths prefill the form identically.
  const address = toAddress([
    {
      formatted_address: place.formattedAddress,
      place_id: place.id ?? placeId,
      address_components: (place.addressComponents ?? []).map((c) => ({
        long_name: c.longText ?? '',
        types: c.types ?? [],
      })),
    },
  ]);

  const value: PlaceAddress = {
    ...withCoords(place.location.latitude, place.location.longitude, address),
    isPrecise: (place.types ?? []).some((t) => PRECISE_TYPES.has(t)),
    isNamed: (place.types ?? []).some((t) => NAMED_TYPES.has(t)),
  };

  if (placeCache.size >= PLACE_CACHE_MAX) {
    // Oldest insertion first — Map preserves insertion order.
    placeCache.delete(placeCache.keys().next().value!);
  }
  placeCache.set(placeId, { value, expiresAt: Date.now() + PLACE_CACHE_TTL_MS });
  return value;
}
