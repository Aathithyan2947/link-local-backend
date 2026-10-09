import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { ApiError } from '../utils/ApiError.js';
import type { ScopeContext } from '../modules/home/home.service.js';

/**
 * Profile visibility (Privacy → Profile visibility), the one rule every place that shows a
 * person applies — their profile page (member or provider) and every list or count of them:
 *   all       → everyone
 *   area      → people whose address is in the same area
 *   apartment → the same area and the same apartment / society
 *   only_me   → nobody else
 * The owner always sees their own profile. No settings saved yet means "all".
 */
export type ProfileVisibility = 'all' | 'area' | 'apartment' | 'only_me';

export type VisibilityAddress = { areaId: number; apartment: string | null } | null;

const sameText = (a: string | null | undefined, b: string | null | undefined) => {
  const x = a?.trim().toLowerCase();
  const y = b?.trim().toLowerCase();
  return !!x && !!y && x === y;
};

/** 'area' needs the same area; 'apartment' also the same apartment / society name. */
export function addressMatches(scope: 'area' | 'apartment', viewer: VisibilityAddress, owner: VisibilityAddress) {
  if (!viewer || !owner || viewer.areaId !== owner.areaId) return false;
  return scope === 'area' || sameText(viewer.apartment, owner.apartment);
}

/** Whether a viewer at [viewer] may see a profile set to [visibility] at [owner]. */
export function profileVisibleTo(
  visibility: string | null | undefined,
  viewer: VisibilityAddress,
  owner: VisibilityAddress,
  isOwner = false,
): boolean {
  if (isOwner) return true;
  switch ((visibility ?? 'all') as ProfileVisibility) {
    case 'all':
      return true;
    case 'area':
    case 'apartment':
      return addressMatches(visibility as 'area' | 'apartment', viewer, owner);
    default:
      return false; // only_me, or anything unknown
  }
}

/** The same rule as a database filter on profiles, for lists and counts. */
export function visibleProfileWhere(viewer: ScopeContext): Prisma.ProfileWhereInput {
  const visibility: Prisma.ProfileWhereInput[] = [
    { privacy: { is: null } }, // never changed their settings: everyone
    { privacy: { is: { profileVisibility: 'all' } } },
  ];
  if (viewer.areaId) {
    visibility.push({ privacy: { is: { profileVisibility: 'area' } }, address: { areaId: viewer.areaId } });
    if (viewer.apartment) {
      visibility.push({
        privacy: { is: { profileVisibility: 'apartment' } },
        address: { areaId: viewer.areaId, apartment: { equals: viewer.apartment.trim(), mode: 'insensitive' } },
      });
    }
  }
  return { OR: visibility };
}

/** Throws 403 "This profile is private" unless [viewerUserId] may see the profile. */
export async function assertProfileVisible(
  owner: { userId: number; profileId: number; address: VisibilityAddress },
  viewerUserId: number | undefined,
) {
  if (viewerUserId === owner.userId) return;
  const privacy = await prisma.profilePrivacySetting.findUnique({
    where: { profileId: owner.profileId },
    select: { profileVisibility: true },
  });
  const visibility = privacy?.profileVisibility ?? 'all';
  if (visibility === 'all') return;
  let viewer: VisibilityAddress = null;
  if (viewerUserId != null && visibility !== 'only_me') {
    const p = await prisma.profile.findUnique({
      where: { userId: viewerUserId },
      select: { address: { select: { areaId: true, apartment: true } } },
    });
    viewer = p?.address ?? null;
  }
  if (!profileVisibleTo(visibility, viewer, owner.address)) throw ApiError.forbidden('This profile is private');
}
