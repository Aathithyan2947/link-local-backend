import { prisma } from '../../lib/prisma.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword } from '../../utils/password.js';

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
              select: {
                area: { select: { areaName: true, city: { select: { name: true } } } },
                verificationDocs: { select: { status: true } },
              },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Tri-state for the Members tab. `isVerified` is canonical (set by approving an address proof,
  // or a manual admin override); when not verified, fall back to the latest proof outcome so a
  // rejection shows as "Rejected" and a fresh re-upload shows as "Pending".
  const items = rows.map((u) => {
    const statuses = (u.profile?.address?.verificationDocs ?? []).map((d) => d.status);
    const verificationStatus = u.isVerified
      ? 'verified'
      : statuses.includes('pending')
        ? 'pending'
        : statuses.includes('rejected')
          ? 'rejected'
          : 'none';
    return { ...u, verificationStatus };
  });

  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

/** Full detail for a single member — powers the individual user page. */
export async function getMemberDetail(userId: number) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      mobile: true,
      userType: true,
      isVerified: true,
      isActive: true,
      isBlocked: true,
      referralCode: true,
      createdAt: true,
      profile: {
        select: {
          name: true,
          photoUrl: true,
          aboutMe: true,
          gender: true,
          completion: { select: { completionPercent: true } },
          address: {
            select: {
              fullAddress: true,
              area: { select: { areaName: true, city: { select: { name: true, state: true } } } },
              verificationDocs: { select: { status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
          educations: { include: { educationMaster: true } },
          professions: { include: { professionMaster: true } },
          hobbies: { include: { hobbyMaster: true } },
          contactDetails: true,
          serviceTypes: { include: { subcategory: { include: { category: true } } } },
        },
      },
    },
  });
  if (!u) throw ApiError.notFound('Member not found');
  const p = u.profile;
  return {
    id: u.id,
    name: p?.name ?? '—',
    email: u.email,
    mobile: u.mobile,
    userType: u.userType,
    isVerified: u.isVerified,
    isActive: u.isActive,
    isBlocked: u.isBlocked,
    referralCode: u.referralCode,
    createdAt: u.createdAt,
    photoUrl: p?.photoUrl ?? null,
    aboutMe: p?.aboutMe ?? null,
    gender: p?.gender ?? null,
    completionPercent: p?.completion?.completionPercent ?? 0,
    fullAddress: p?.address?.fullAddress ?? null,
    area: p?.address?.area?.areaName ?? null,
    city: p?.address?.area?.city?.name ?? null,
    state: p?.address?.area?.city?.state ?? null,
    docStatus: p?.address?.verificationDocs[0]?.status ?? 'none',
    educations: (p?.educations ?? []).map((e) =>
      [e.degree ?? e.educationMaster?.degree, e.collegeName ?? e.educationMaster?.collegeName, e.schoolName ?? e.educationMaster?.schoolName]
        .filter(Boolean)
        .join(' · ') || 'Education',
    ),
    professions: (p?.professions ?? []).map((pr) => ({
      category: pr.professionMaster?.category ?? '—',
      company: pr.companyOrDetail ?? null,
    })),
    hobbies: (p?.hobbies ?? []).map((h) => h.hobbyMaster?.name ?? h.customHobby).filter(Boolean),
    contacts: (p?.contactDetails ?? []).map((c) => ({ type: c.contactType, value: c.value })),
    services: (p?.serviceTypes ?? []).map((s) => s.subcategory?.name ?? '—'),
  };
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
  if (params.status === 'verified') {
    where.isVerified = true;
  } else if (params.status === 'rejected') {
    // Rejected and not since verified — so a reject visibly moves the member here.
    where.isVerified = false;
    where.profileVerifications = { some: { status: 'rejected' } };
  } else {
    // pending (default): unverified members who haven't been decided yet, so approving OR
    // rejecting removes them from this queue.
    where.isVerified = false;
    where.profileVerifications = { none: {} };
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
  // Reflect the decision on the member's flag both ways (approve verifies, reject un-verifies)
  // so the Members tab never shows a stale "Verified".
  await prisma.user.update({
    where: { id: userId },
    data: { isVerified: status === 'approved' },
  });
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
export async function listActivityLogs(
  params: PaginationParams & { q?: string; action?: string; adminId?: number; from?: string; to?: string },
) {
  const where: Record<string, unknown> = {};
  if (params.adminId) where.adminId = params.adminId;
  if (params.action) where.action = { contains: params.action, mode: 'insensitive' };
  if (params.q) {
    where.OR = [
      { action: { contains: params.q, mode: 'insensitive' } },
      { entityType: { contains: params.q, mode: 'insensitive' } },
      { admin: { name: { contains: params.q, mode: 'insensitive' } } },
    ];
  }
  if (params.from || params.to) {
    const range: Record<string, Date> = {};
    if (params.from) range.gte = new Date(params.from);
    if (params.to) range.lte = new Date(`${params.to}T23:59:59.999`);
    where.performedAt = range;
  }

  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { performedAt: 'desc' },
      ...toPrismaPagination(params),
      include: { admin: { select: { name: true, email: true } } },
    }),
    prisma.adminAuditLog.count({ where }),
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

// ── Profile tag assignment (ProfileTagMap) ───────────────────
export async function getMemberTags(userId: number) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return { tagIds: [] as number[] };
  const maps = await prisma.profileTagMap.findMany({
    where: { profileId: profile.id },
    select: { tagId: true },
  });
  return { tagIds: maps.map((m) => m.tagId) };
}

/** Replace the full set of tags on a member's profile. */
export async function setMemberTags(userId: number, tagIds: number[], adminId: number) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) throw ApiError.notFound('Profile not found');
  const unique = Array.from(new Set(tagIds));
  await prisma.$transaction([
    prisma.profileTagMap.deleteMany({ where: { profileId: profile.id } }),
    prisma.profileTagMap.createMany({
      data: unique.map((tagId) => ({ profileId: profile.id, tagId, assignedBy: adminId })),
    }),
  ]);
  return getMemberTags(userId);
}

// ── Admins management (super admin only) ─────────────────────
const adminSelect = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } as const;

export async function listAdmins(params: PaginationParams & { q?: string }) {
  const where: Record<string, unknown> = {};
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { email: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.admin.findMany({ where, orderBy: { createdAt: 'desc' }, ...toPrismaPagination(params), select: adminSelect }),
    prisma.admin.count({ where }),
  ]);
  return { items: rows, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function createAdmin(input: { name: string; email: string; password: string; role: string }) {
  const existing = await prisma.admin.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('An admin with this email already exists');
  return prisma.admin.create({
    data: { name: input.name, email: input.email, password: await hashPassword(input.password), role: input.role },
    select: adminSelect,
  });
}

export async function updateAdmin(
  id: number,
  input: { name?: string; role?: string; isActive?: boolean; password?: string },
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password) data.password = await hashPassword(input.password);
  return prisma.admin.update({ where: { id }, data, select: adminSelect });
}
