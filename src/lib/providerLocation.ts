import { prisma } from './prisma.js';
import { distanceKm } from './cityArea.js';

/**
 * What a provider list card may say about where a provider is: their area and city, and a
 * rounded distance from the viewer. Never the street, building or coordinates.
 */
export interface PublicProviderLocation {
  areaName: string | null;
  cityName: string | null;
  /** e.g. "< 500 m", "1.5 km", "10+ km"; null when either side has no coordinates. */
  distanceLabel: string | null;
}

/** Prisma `include` fragment that loads just enough of the address to build the above. */
export const providerLocationInclude = {
  address: {
    select: {
      latitude: true,
      longitude: true,
      area: { select: { areaName: true, city: { select: { name: true } } } },
    },
  },
} as const;

type Coords = { latitude: number; longitude: number };

type WithAddress = {
  address: {
    latitude: unknown;
    longitude: unknown;
    area: { areaName: string; city: { name: string } } | null;
  } | null;
};

function coordsOf(a: { latitude: unknown; longitude: unknown } | null | undefined): Coords | null {
  if (a?.latitude == null || a.longitude == null) return null;
  return { latitude: Number(a.latitude), longitude: Number(a.longitude) };
}

/** The viewer's own address coordinates, the origin for distances. */
export async function viewerCoords(userId: number): Promise<Coords | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { address: { select: { latitude: true, longitude: true } } },
  });
  return coordsOf(profile?.address);
}

/**
 * Rounds a distance to coarse steps. An exact distance to someone's home, taken from a few
 * different vantage points, pins down where they live; half-kilometre steps don't.
 */
export function distanceLabel(km: number): string {
  if (km < 0.5) return '< 500 m';
  if (km >= 10) return '10+ km';
  const stepped = Math.ceil(km * 2) / 2;
  return `${Number.isInteger(stepped) ? stepped.toFixed(0) : stepped.toFixed(1)} km`;
}

/** Replaces a provider row's raw address with its public location. */
export function withPublicLocation<T extends WithAddress>(
  row: T,
  viewer: Coords | null,
): Omit<T, 'address'> & PublicProviderLocation {
  const { address, ...rest } = row;
  const at = coordsOf(address);
  return {
    ...rest,
    areaName: address?.area?.areaName ?? null,
    cityName: address?.area?.city.name ?? null,
    distanceLabel:
      viewer && at ? distanceLabel(distanceKm(viewer.latitude, viewer.longitude, at.latitude, at.longitude)) : null,
  };
}
