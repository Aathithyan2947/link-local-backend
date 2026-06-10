import { prisma } from '../../lib/prisma.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';

export async function listMembers(
  params: PaginationParams & { q?: string; userType?: string; status?: string },
) {
  const where: Record<string, unknown> = {};
  if (params.userType) where.userType = params.userType;
  if (params.status === 'active') where.isActive = true;
  if (params.status === 'inactive') where.isActive = false;
  if (params.status === 'blocked') where.isBlocked = true;
  if (params.q) {
    where.OR = [
      { email: { contains: params.q, mode: 'insensitive' } },
      { mobile: { contains: params.q, mode: 'insensitive' } },
      { profile: { name: { contains: params.q, mode: 'insensitive' } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toPrismaPagination(params),
      select: {
        id: true,
        email: true,
        mobile: true,
        userType: true,
        isVerified: true,
        isActive: true,
        isBlocked: true,
        createdAt: true,
        profile: {
          select: {
            name: true,
            photoUrl: true,
            address: {
              select: { area: { select: { areaName: true, city: { select: { name: true } } } } },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { items: rows, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function setMemberStatus(userId: number, patch: { isActive?: boolean; isBlocked?: boolean; isVerified?: boolean }) {
  return prisma.user.update({
    where: { id: userId },
    data: patch,
    select: { id: true, isActive: true, isBlocked: true, isVerified: true },
  });
}

// ── Profile verification queue ───────────────────────────────
export async function listVerifications(params: PaginationParams & { status?: string }) {
  const where: Record<string, unknown> = {};
  if (params.status === 'verified') where.isVerified = true;
  else if (params.status === 'pending') where.isVerified = false;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toPrismaPagination(params),
      select: {
        id: true,
        email: true,
        mobile: true,
        userType: true,
        isVerified: true,
        createdAt: true,
        profile: {
          select: {
            name: true,
            completion: { select: { completionPercent: true } },
            address: {
              select: {
                fullAddress: true,
                verificationDocs: { orderBy: { createdAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const items = rows.map((u) => ({
    id: u.id,
    name: u.profile?.name ?? '—',
    email: u.email,
    mobile: u.mobile,
    userType: u.userType,
    isVerified: u.isVerified,
    completionPercent: u.profile?.completion?.completionPercent ?? 0,
    fullAddress: u.profile?.address?.fullAddress ?? null,
    docStatus: u.profile?.address?.verificationDocs[0]?.status ?? 'none',
    docUrl: u.profile?.address?.verificationDocs[0]?.docUrl ?? null,
    createdAt: u.createdAt,
  }));
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function reviewVerification(
  userId: number,
  status: 'approved' | 'rejected',
  adminId: number,
  rejectionReason?: string,
) {
  await prisma.profileVerification.create({
    data: {
      userId,
      status,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: status === 'rejected' ? rejectionReason : undefined,
    },
  });
  if (status === 'approved') {
    await prisma.user.update({ where: { id: userId }, data: { isVerified: true } });
  }
  return { userId, status };
}

// ── "Other" service approval queue ───────────────────────────
export async function listPendingServices() {
  const rows = await prisma.serviceSubcategory.findMany({
    where: { isActive: false },
    include: { category: { select: { name: true } }, _count: { select: { serviceTypes: true } } },
    orderBy: { id: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category.name,
    providers: r._count.serviceTypes,
  }));
}

export async function approveService(id: number) {
  return prisma.serviceSubcategory.update({ where: { id }, data: { isActive: true } });
}

// ── New members showcase ─────────────────────────────────────
export async function listNewMembers(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.user.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      userType: true,
      createdAt: true,
      profile: {
        select: {
          name: true,
          photoUrl: true,
          aboutMe: true,
          address: { select: { area: { select: { areaName: true, city: { select: { name: true } } } } } },
        },
      },
    },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.profile?.name ?? '—',
    photoUrl: u.profile?.photoUrl ?? null,
    aboutMe: u.profile?.aboutMe ?? null,
    userType: u.userType,
    area: u.profile?.address?.area?.areaName ?? null,
    city: u.profile?.address?.area?.city?.name ?? null,
    joinedAt: u.createdAt,
  }));
}

// ── Events / Groups lists ────────────────────────────────────
export async function listEventsAdmin(params: PaginationParams & { q?: string }) {
  const where: Record<string, unknown> = {};
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };
  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { date: 'desc' },
      ...toPrismaPagination(params),
      include: {
        creator: { select: { profile: { select: { name: true } } } },
        _count: { select: { attendees: true } },
      },
    }),
    prisma.event.count({ where }),
  ]);
  return { items: rows, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function listGroupsAdmin(params: PaginationParams & { q?: string }) {
  const where: Record<string, unknown> = {};
  if (params.q) where.title = { contains: params.q, mode: 'insensitive' };
  const [rows, total] = await Promise.all([
    prisma.interestGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toPrismaPagination(params),
      include: {
        creator: { select: { profile: { select: { name: true } } } },
        _count: { select: { members: true } },
      },
    }),
    prisma.interestGroup.count({ where }),
  ]);
  return { items: rows, meta: buildMeta(params.page, params.pageSize, total) };
}

// ── Activity logs ────────────────────────────────────────────
export async function listActivityLogs(params: PaginationParams) {
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      orderBy: { performedAt: 'desc' },
      ...toPrismaPagination(params),
      include: { admin: { select: { name: true, email: true } } },
    }),
    prisma.adminAuditLog.count(),
  ]);
  return { items: rows, meta: buildMeta(params.page, params.pageSize, total) };
}

// ── Reports ──────────────────────────────────────────────────
export async function getReports() {
  const [byCity, byType, topCategories, totalAddresses] = await Promise.all([
    prisma.city.findMany({
      select: { name: true, _count: { select: { cityMemberships: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.user.groupBy({ by: ['userType'], _count: { _all: true } }),
    prisma.serviceSubcategory.findMany({
      where: { isActive: true },
      select: { name: true, _count: { select: { serviceTypes: true } } },
      orderBy: { serviceTypes: { _count: 'desc' } },
      take: 8,
    }),
    prisma.address.count(),
  ]);

  return {
    membersByCity: byCity.map((c) => ({ city: c.name, members: c._count.cityMemberships })),
    membersByType: byType.map((t) => ({ userType: t.userType, count: t._count._all })),
    topServiceCategories: topCategories.map((c) => ({ name: c.name, providers: c._count.serviceTypes })),
    totalAddresses,
  };
}

export async function getDashboard() {
  const [residents, serviceProviders, events, groups, posts, pendingDocs, pendingVerifications] =
    await Promise.all([
      prisma.user.count({ where: { userType: 'resident' } }),
      prisma.user.count({ where: { userType: 'service_provider' } }),
      prisma.event.count(),
      prisma.interestGroup.count(),
      prisma.post.count(),
      prisma.addressVerificationDoc.count({ where: { status: 'pending' } }),
      prisma.profileVerification.count({ where: { status: 'pending' } }),
    ]);

  return {
    members: { residents, serviceProviders, total: residents + serviceProviders },
    events,
    groups,
    posts,
    pending: { addressDocs: pendingDocs, profileVerifications: pendingVerifications },
  };
}
