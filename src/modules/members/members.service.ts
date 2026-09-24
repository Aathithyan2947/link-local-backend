import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import {
  addressScopeFilter,
  type HomeScope,
  resolveUserScopeContext,
  sanitizeAreaOverride,
  type ScopeContext,
} from '../home/home.service.js';

/**
 * The members a viewer may see in a scope — shared by the Members list and Home's
 * "Members" counter, so the number on the tile always equals the list behind it.
 *
 * Everyone in the scope except: the viewer themselves; deactivated or admin-blocked
 * accounts; anyone in a full block with the viewer (either direction); and anyone whose
 * profile visibility excludes the viewer — "only me", or "area"/"apartment" when the
 * viewer doesn't live there (the same rule the public profile applies).
 */
export function visibleMembersWhere(
  viewerId: number,
  viewer: ScopeContext,
  scopeFilter: Record<string, unknown>,
): Prisma.ProfileWhereInput {
  const visibility: Prisma.ProfileWhereInput[] = [
    { privacy: { is: null } }, // never changed their settings: default is everyone
    { privacy: { is: { profileVisibility: 'all' } } },
  ];
  if (viewer.areaId) {
    visibility.push({ privacy: { is: { profileVisibility: 'area' } }, address: { areaId: viewer.areaId } });
    if (viewer.apartment) {
      visibility.push({
        privacy: { is: { profileVisibility: 'apartment' } },
        address: { areaId: viewer.areaId, apartment: { equals: viewer.apartment, mode: 'insensitive' } },
      });
    }
  }
  return {
    AND: [Object.keys(scopeFilter).length ? { address: scopeFilter } : {}, { OR: visibility }],
    userId: { not: viewerId },
    user: {
      isActive: true,
      isBlocked: false,
      blocksInitiated: { none: { blockedId: viewerId, blockScope: 'full' } },
      blocksReceived: { none: { blockerId: viewerId, blockScope: 'full' } },
    },
  };
}

/** One Members-list row: who they are and roughly where — never address or contact details. */
export interface MemberItem {
  profileId: number;
  userId: number;
  name: string;
  photoUrl: string | null;
  isServiceProvider: boolean;
  /** Their service (providers) or profession (residents), when set. */
  roleLabel: string | null;
  areaName: string | null;
}

export async function listMembers(
  viewerId: number,
  params: PaginationParams & { scope?: HomeScope; areaId?: number; q?: string },
) {
  const ctx = await resolveUserScopeContext(viewerId);
  const overrideAreaId = await sanitizeAreaOverride(params.areaId, ctx.cityId);
  const where: Prisma.ProfileWhereInput = {
    ...visibleMembersWhere(viewerId, ctx, addressScopeFilter(params.scope ?? 'city', ctx, overrideAreaId)),
    ...(params.q?.trim() && { name: { contains: params.q.trim(), mode: 'insensitive' } }),
  };

  const [rows, total] = await Promise.all([
    prisma.profile.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        name: true,
        photoUrl: true,
        user: { select: { userType: true } },
        address: { select: { area: { select: { areaName: true } } } },
        serviceTypes: { take: 1, select: { subcategory: { select: { name: true } } } },
        professions: { take: 1, select: { professionMaster: { select: { category: true } } } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.profile.count({ where }),
  ]);

  const items: MemberItem[] = rows.map((r) => {
    const isServiceProvider = r.user.userType === 'service_provider';
    return {
      profileId: r.id,
      userId: r.userId,
      name: r.name,
      photoUrl: r.photoUrl,
      isServiceProvider,
      roleLabel: isServiceProvider
        ? (r.serviceTypes[0]?.subcategory.name ?? null)
        : (r.professions[0]?.professionMaster?.category ?? null),
      areaName: r.address?.area?.areaName ?? null,
    };
  });
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}
