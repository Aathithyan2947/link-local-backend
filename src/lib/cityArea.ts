import type { Prisma } from '@prisma/client';

const EARTH_RADIUS_KM = 6371;

/** The service-area columns of a City row. */
export interface CityAreaFields {
  centerLat: Prisma.Decimal | number | null;
  centerLng: Prisma.Decimal | number | null;
  radiusKm: Prisma.Decimal | number | null;
}

export interface CityArea {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/** The city's service circle, or null when an admin has not set one yet. */
export function cityArea(city: CityAreaFields): CityArea | null {
  if (city.centerLat == null || city.centerLng == null || city.radiusKm == null) return null;
  return {
    latitude: Number(city.centerLat),
    longitude: Number(city.centerLng),
    radiusKm: Number(city.radiusKm),
  };
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Whether a point lies in the city's service area: true/false, or null when the
 * city has no area set and so cannot be judged geographically.
 */
export function isInCityArea(city: CityAreaFields, lat: number, lng: number): boolean | null {
  const area = cityArea(city);
  if (!area) return null;
  return distanceKm(area.latitude, area.longitude, lat, lng) <= area.radiusKm;
}
