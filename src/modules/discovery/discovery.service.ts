import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { resolveUserCityId } from '../home/home.service.js';

const byCreatorCity = (cityId: number | null) =>
  cityId ? { creator: { profile: { address: { area: { cityId } } } } } : {};

// ── Events / Workshops ───────────────────────────────────────
export async function listEvents(userId: number, params: PaginationParams & { q?: string }) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = { isActive: true, ...byCreatorCity(cityId) };
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        _count: { select: { attendees: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.event.count({ where }),
  ]);
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getEvent(id: number) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
      rawMaterials: true,
      _count: { select: { attendees: true } },
    },
  });
  if (!event) throw ApiError.notFound('Event not found');
  return event;
}

// ── Interest Groups ──────────────────────────────────────────
export async function listGroups(userId: number, params: PaginationParams & { q?: string }) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = { isActive: true, ...byCreatorCity(cityId) };
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.interestGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        _count: { select: { members: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.interestGroup.count({ where }),
  ]);
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getGroup(id: number) {
  const group = await prisma.interestGroup.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
      _count: { select: { members: true } },
    },
  });
  if (!group) throw ApiError.notFound('Group not found');
  return group;
}

// ── Service Providers ────────────────────────────────────────
export async function listServiceProviders(
  userId: number,
  params: PaginationParams & { q?: string; subcategoryId?: number },
) {
  const cityId = await resolveUserCityId(userId);
  const where: Record<string, unknown> = {
    user: { userType: 'service_provider', isActive: true },
  };
  if (cityId) where.address = { area: { cityId } };
  if (params.q) where.name = { contains: params.q, mode: 'insensitive' };
  if (params.subcategoryId)
    where.serviceTypes = { some: { subcategoryId: params.subcategoryId } };

  const [items, total] = await Promise.all([
    prisma.profile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        serviceTypes: { include: { subcategory: true } },
        _count: { select: { ratings: true } },
      },
      ...toPrismaPagination(params),
    }),
    prisma.profile.count({ where }),
  ]);
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function getServiceProvider(id: number) {
  const sp = await prisma.profile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, userType: true, mobile: true } },
      serviceTypes: { include: { subcategory: { include: { category: true } } } },
      products: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } },
      media: { orderBy: { sortOrder: 'asc' } },
      delivery: true,
      paymentTerms: true,
      ratings: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { rater: { select: { profile: { select: { name: true } } } } },
      },
    },
  });
  if (!sp) throw ApiError.notFound('Service provider not found');
  return sp;
}
