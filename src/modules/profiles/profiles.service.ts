import { prisma } from '../../lib/prisma.js';
import { withViewerEventState } from '../../lib/eventTiming.js';
import { destroyByUrl } from '../../lib/cloudinary.js';
import { ApiError } from '../../utils/ApiError.js';
import { dateOnly } from '../../lib/slots.js';
import { resolveProviderKind, resolveProviderFeatures } from '../../lib/providerKind.js';
import { getCustomFieldsForProfile } from '../../lib/customFields.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import type { z } from 'zod';
import type {
  aboutSchema,
  availabilitySchema,
  blackoutSchema,
  contactSchema,
  deliverySchema,
  ratesSchema,
  educationSchema,
  familySchema,
  hobbySchema,
  paymentMethodSchema,
  paymentTermsSchema,
  productCustomizationSchema,
  notificationPrefsSchema,
  productSchema,
  professionSchema,
  professionsSchema,
  reportProfileSchema,
  serviceTypesSchema,
  updateProfileSchema,
  visibilitySchema,
} from './profiles.schema.js';

/** Returns the profile row for a user, or throws 404. */
async function requireProfile(userId: number) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw ApiError.notFound('Profile not found');
  return profile;
}

/** The SP's menu / date-booking flags on their own — two small queries, not the full profile. */
export async function getMyProviderFeatures(userId: number) {
  const profile = await requireProfile(userId);
  return resolveProviderFeatures(profile.id);
}

export async function getMyProfile(userId: number) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, email: true, mobile: true, userType: true, isVerified: true } },
      address: { include: { area: { include: { city: true } }, verificationDocs: true } },
      educations: { include: { educationMaster: true } },
      professions: { include: { professionMaster: true } },
      hobbies: { include: { hobbyMaster: true } },
      family: true,
      pets: true,
      contactDetails: true,
      serviceTypes: { include: { subcategory: { include: { category: true } } } },
      products: { orderBy: { sortOrder: 'asc' }, include: withCustomizations },
      rates: { where: { isActive: true } },
      delivery: true,
      availability: true,
      paymentTerms: true,
      paymentMethods: true,
      completion: true,
    },
  });
  if (!profile) throw ApiError.notFound('Profile not found');
  const providerKind = await resolveProviderKind(profile.id);
  const { hasMenu, hasDateBooking } = await resolveProviderFeatures(profile.id);
  return { ...profile, providerKind, hasMenu, hasDateBooking };
}

/**
 * Records that the SP finished the onboarding chain — called when the final step's Confirm
 * lands. Idempotent: re-running the chain later keeps the original completion time, so the
 * one-time congratulations can't be re-triggered by editing a step.
 */
export async function markOnboardingComplete(userId: number) {
  const profile = await requireProfile(userId);
  if (profile.onboardingCompletedAt) return profile;
  return prisma.profile.update({
    where: { id: profile.id },
    data: { onboardingCompletedAt: new Date() },
  });
}

// ── Service SP rates (per session / monthly / hourly) ────────
export async function getMyRates(userId: number) {
  const profile = await requireProfile(userId);
  return prisma.spRate.findMany({ where: { profileId: profile.id, isActive: true }, orderBy: { id: 'asc' } });
}

export async function setRates(userId: number, input: z.infer<typeof ratesSchema>) {
  const profile = await requireProfile(userId);
  // Replace-all (like setServiceTypes): one active row per rateType.
  const seen = new Set<string>();
  const rows = input.rates.filter((r) => (seen.has(r.rateType) ? false : (seen.add(r.rateType), true)));
  await prisma.$transaction([
    prisma.spRate.deleteMany({ where: { profileId: profile.id } }),
    prisma.spRate.createMany({ data: rows.map((r) => ({ profileId: profile.id, rateType: r.rateType, amount: r.amount })) }),
  ]);
  await recomputeCompletion(profile.id);
  return prisma.spRate.findMany({ where: { profileId: profile.id, isActive: true }, orderBy: { id: 'asc' } });
}

type OwnerAddress = { areaId: number; apartment: string | null } | null;

/** 'area' scope requires the same area; 'apartment' also requires the same free-text apartment name. */
function addressMatches(scope: 'area' | 'apartment', viewer: OwnerAddress, owner: OwnerAddress): boolean {
  if (!viewer || !owner || viewer.areaId !== owner.areaId) return false;
  if (scope === 'area') return true;
  const a = viewer.apartment?.trim().toLowerCase();
  const b = owner.apartment?.trim().toLowerCase();
  return !!a && !!b && a === b;
}

/** Public profile view (the "User" frame) — any member viewing another member. */
export async function getPublicProfile(profileId: number, viewerUserId: number) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      user: { select: { id: true, userType: true, mobile: true, email: true } },
      address: { include: { area: { include: { city: true } } } },
      educations: { include: { educationMaster: true } },
      professions: { include: { professionMaster: true } },
      privacy: { select: { profileVisibility: true, contactVisibility: true } },
    },
  });
  if (!profile) throw ApiError.notFound('Profile not found');
  const userId = profile.userId;
  const isOwner = viewerUserId === userId;

  if (!isOwner) {
    const block = await prisma.blockedUser.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: viewerUserId } },
    });
    if (block) throw ApiError.forbidden('This profile is not visible to you.');
  }

  const profileVisibility = profile.privacy?.profileVisibility ?? 'all';
  const contactVisibility = profile.privacy?.contactVisibility ?? 'only_me';
  const needsAddressCompare = ['area', 'apartment'].includes(profileVisibility) || ['area', 'apartment'].includes(contactVisibility);

  let viewerAddress: OwnerAddress = null;
  if (!isOwner && needsAddressCompare) {
    const viewerProfile = await prisma.profile.findUnique({
      where: { userId: viewerUserId },
      select: { address: { select: { areaId: true, apartment: true } } },
    });
    viewerAddress = viewerProfile?.address ?? null;
  }
  const ownerAddress: OwnerAddress = profile.address ? { areaId: profile.address.areaId, apartment: profile.address.apartment } : null;

  const profileVisible =
    isOwner ||
    profileVisibility === 'all' ||
    (profileVisibility !== 'only_me' && addressMatches(profileVisibility as 'area' | 'apartment', viewerAddress, ownerAddress));
  if (!profileVisible) throw ApiError.forbidden('This profile is not visible to you.');

  let contactVisible =
    isOwner ||
    contactVisibility === 'all' ||
    (['area', 'apartment'].includes(contactVisibility) &&
      addressMatches(contactVisibility as 'area' | 'apartment', viewerAddress, ownerAddress));
  if (!contactVisible && !isOwner && contactVisibility === 'has_ordered') {
    const order = await prisma.order.findFirst({ where: { buyerId: viewerUserId, spProfile: { userId } } });
    contactVisible = !!order;
  }

  const eventInclude = {
    creator: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
    _count: { select: { attendees: true } },
  };

  const [hosted, attending, posts, adminGroups, memberGroups, servicesContacted] = await Promise.all([
    prisma.event.findMany({ where: { creatorId: userId, isActive: true }, orderBy: { date: 'desc' }, take: 10, include: eventInclude }),
    prisma.event.findMany({ where: { isActive: true, attendees: { some: { userId, status: 'joined' } } }, orderBy: { date: 'desc' }, take: 10, include: eventInclude }),
    prisma.post.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: { select: { id: true, profile: { select: { name: true, photoUrl: true } } } },
        media: { take: 1, orderBy: { sortOrder: 'asc' } },
        _count: { select: { likes: true, comments: true } },
      },
    }),
    prisma.interestGroupAdmin.findMany({ where: { userId }, include: { group: { include: { _count: { select: { members: true } } } } } }),
    prisma.interestGroupMember.findMany({ where: { userId, status: 'joined' }, include: { group: { include: { _count: { select: { members: true } } } } } }),
    prisma.serviceProviderRating.count({ where: { ratedBy: userId } }),
  ]);

  const hostedIds = new Set(hosted.map((e) => e.id));
  const events = await withViewerEventState(
    [
      ...hosted.map((e) => ({ ...e, relation: 'hosting' as const })),
      ...attending.filter((e) => !hostedIds.has(e.id)).map((e) => ({ ...e, relation: 'attending' as const })),
    ],
    viewerUserId,
  );
  const adminGroupIds = new Set(adminGroups.map((a) => a.groupId));
  const groups = [
    ...adminGroups.map((a) => ({ ...a.group, role: 'admin' as const })),
    ...memberGroups.filter((m) => !adminGroupIds.has(m.groupId)).map((m) => ({ ...m.group, role: 'member' as const })),
  ];

  return {
    ...profile,
    user: {
      ...profile.user,
      mobile: contactVisible ? profile.user.mobile : null,
      email: contactVisible ? profile.user.email : null,
    },
    events,
    posts,
    groups,
    servicesContacted,
  };
}

export async function updateProfile(userId: number, data: z.infer<typeof updateProfileSchema>) {
  const profile = await requireProfile(userId);
  const updated = await prisma.profile.update({ where: { id: profile.id }, data });
  await recomputeCompletion(profile.id);
  return updated;
}

/** Records how the member found us + who referred them (captured at address verification). */
export async function setReferral(userId: number, input: { referralCode?: string; referralSourceId?: number }) {
  const data: { referredBy?: number; referralSourceId?: number } = {};
  const code = input.referralCode?.trim();
  if (code) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!referrer) throw ApiError.badRequest("That referral code isn't valid. Check the member ID and try again.");
    if (referrer.id === userId) throw ApiError.badRequest("You can't use your own referral code.");
    data.referredBy = referrer.id;
  }
  if (input.referralSourceId != null) data.referralSourceId = input.referralSourceId;
  if (Object.keys(data).length === 0) return { updated: false };
  await prisma.user.update({ where: { id: userId }, data });
  return { updated: true };
}

export async function setPhoto(userId: number, photoUrl: string) {
  const profile = await requireProfile(userId);
  const oldPhotoUrl = profile.photoUrl;
  const updated = await prisma.profile.update({ where: { id: profile.id }, data: { photoUrl } });
  await recomputeCompletion(profile.id);
  if (oldPhotoUrl && oldPhotoUrl !== photoUrl) void destroyByUrl(oldPhotoUrl, 'image');
  return updated;
}

export async function updateEmail(userId: number, email: string | null) {
  if (email === null) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { mobile: true } });
    if (!user?.mobile) throw ApiError.badRequest('Add a phone number before removing your email.');
    return prisma.user.update({ where: { id: userId }, data: { email: null }, select: { id: true, email: true } });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== userId) throw ApiError.badRequest('That email is already in use.');
  return prisma.user.update({ where: { id: userId }, data: { email }, select: { id: true, email: true } });
}

export async function updatePhone(userId: number, mobile: string | null) {
  if (mobile === null) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) throw ApiError.badRequest('Add an email before removing your phone number.');
    return prisma.user.update({ where: { id: userId }, data: { mobile: null }, select: { id: true, mobile: true } });
  }
  const existing = await prisma.user.findUnique({ where: { mobile } });
  if (existing && existing.id !== userId) throw ApiError.conflict('That phone number is already in use.');
  return prisma.user.update({ where: { id: userId }, data: { mobile }, select: { id: true, mobile: true } });
}

export async function changePassword(userId: number, currentPassword: string | undefined, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.passwordHash) {
    if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw ApiError.unauthorized('Current password is incorrect.');
    }
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, authType: 'password' } });
  return { changed: true };
}

// ── Work Gallery (photos + videos) ────────────────────────────
export async function addMedia(userId: number, mediaType: 'photo' | 'video', url: string) {
  const profile = await requireProfile(userId);
  const count = await prisma.profileMedia.count({ where: { profileId: profile.id } });
  return prisma.profileMedia.create({ data: { profileId: profile.id, mediaType, url, sortOrder: count } });
}

/** Records a profile share in the unified entity_shares log. */
export async function shareProfile(userId: number, profileId: number, channel?: string) {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } });
  if (!profile) throw ApiError.notFound('Profile not found');
  await prisma.entityShare.create({
    data: { userId, entityType: 'profile', entityId: profileId, sharingChannel: channel ?? 'in_app' },
  });
  return { shared: true };
}

// ── Abuse reports ──────────────────────────────────────────────
export async function reportProfile(reporterId: number, profileId: number, input: z.infer<typeof reportProfileSchema>) {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { userId: true } });
  if (!profile) throw ApiError.notFound('Profile not found');
  return prisma.abuseReport.create({
    data: {
      reportedBy: reporterId,
      entityType: 'user',
      entityId: profile.userId,
      reportedUserId: profile.userId,
      reason: input.reason,
      status: 'pending',
    },
  });
}

// Degree, School and College are independent curated catalogs. Reuse a matching entry
// (case-insensitive), else queue a brand-new "Other" suggestion as pending (isActive=false)
// so it stays out of the app's pickers until an admin approves it.
async function resolveCatalogId(
  find: (value: string) => Promise<{ id: number } | null>,
  create: (value: string) => Promise<{ id: number }>,
  value?: string,
): Promise<number | undefined> {
  const v = value?.trim();
  if (!v) return undefined;
  const existing = await find(v);
  return existing?.id ?? (await create(v)).id;
}

// ── Education (curated degree/school/college catalogs + self-suggested "Other") ──
export async function addEducation(userId: number, input: z.infer<typeof educationSchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.profileEducation.create({
    data: await educationRow(profile.id, input),
    include: { educationMaster: true },
  });
  await recomputeCompletion(profile.id);
  return row;
}

/**
 * One profile_education row's data: resolves the degree/school/college against their
 * catalogs (queueing new "Other" values as pending) and keeps the member's own wording.
 */
async function educationRow(profileId: number, input: z.infer<typeof educationSchema>) {
  const degree = input.degree?.trim();
  const educationMasterId =
    input.educationMasterId ??
    (await resolveCatalogId(
      (v) => prisma.educationMaster.findFirst({ where: { degree: { equals: v, mode: 'insensitive' } } }),
      (v) => prisma.educationMaster.create({ data: { degree: v, isActive: false } }),
      degree,
    ));

  const schoolMasterId = await resolveCatalogId(
    (v) => prisma.schoolMaster.findFirst({ where: { name: { equals: v, mode: 'insensitive' } } }),
    (v) => prisma.schoolMaster.create({ data: { name: v, isActive: false } }),
    input.schoolName,
  );

  const collegeMasterId = await resolveCatalogId(
    (v) => prisma.collegeMaster.findFirst({ where: { name: { equals: v, mode: 'insensitive' } } }),
    (v) => prisma.collegeMaster.create({ data: { name: v, isActive: false } }),
    input.collegeName,
  );

  // The member's chosen names + cities are denormalized on their profile row for display.
  return {
    profileId,
    educationMasterId,
    schoolMasterId,
    collegeMasterId,
    degree,
    schoolName: input.schoolName?.trim() || undefined,
    schoolCity: input.schoolCity,
    collegeName: input.collegeName?.trim() || undefined,
    collegeCity: input.collegeCity,
    university: input.university,
    postGradCollege: input.postGradCollege,
    postGradCity: input.postGradCity,
  };
}

// ── Profession (curated category + self-suggested "Other") ──────
/** The master id for one profession input, creating a pending master for a new free-text category. */
async function resolveProfessionMasterId(input: z.infer<typeof professionSchema>) {
  if (input.professionMasterId) return input.professionMasterId;
  if (input.category?.trim()) {
    const category = input.category.trim();
    // Reuse an existing category (case-insensitive, any status) to avoid duplicate pendings;
    // a brand-new "Other" category is queued as pending (isActive=false) for admin approval.
    const existing = await prisma.professionMaster.findFirst({
      where: { category: { equals: category, mode: 'insensitive' } },
    });
    return existing?.id ?? (await prisma.professionMaster.create({ data: { category, isActive: false } })).id;
  }
  throw ApiError.badRequest('professionMasterId or category required');
}

export async function addProfession(userId: number, input: z.infer<typeof professionSchema>) {
  const profile = await requireProfile(userId);
  const professionMasterId = await resolveProfessionMasterId(input);
  const row = await prisma.profileProfession.create({
    data: { profileId: profile.id, professionMasterId, companyOrDetail: input.companyOrDetail },
    include: { professionMaster: true },
  });
  await recomputeCompletion(profile.id);
  return row;
}

/**
 * Saves the profile's About block as one unit: About Me, and the whole education and
 * profession sets replaced in a single transaction. Catalog lookups (which may queue new
 * "Other" entries) run first, since each is its own write. Empty entries are dropped.
 */
export async function setAbout(userId: number, input: z.infer<typeof aboutSchema>) {
  const profile = await requireProfile(userId);

  const educations = [];
  for (const e of input.educations) {
    if (![e.degree, e.schoolName, e.collegeName].some((v) => v?.trim())) continue;
    educations.push(await educationRow(profile.id, e));
  }
  const professions = [];
  for (const p of input.professions) {
    if (!p.professionMasterId && !p.category?.trim()) continue;
    professions.push({
      profileId: profile.id,
      professionMasterId: await resolveProfessionMasterId(p),
      companyOrDetail: p.companyOrDetail?.trim() || null,
    });
  }

  await prisma.$transaction([
    prisma.profile.update({
      where: { id: profile.id },
      data: { aboutMe: input.aboutMe.trim() || null },
    }),
    prisma.profileEducation.deleteMany({ where: { profileId: profile.id } }),
    prisma.profileEducation.createMany({ data: educations }),
    prisma.profileProfession.deleteMany({ where: { profileId: profile.id } }),
    prisma.profileProfession.createMany({ data: professions }),
  ]);
  await recomputeCompletion(profile.id);
  return getMyProfile(userId);
}

/**
 * Replaces the profile's whole profession set (like [setRates]) — for callers that own every
 * entry rather than appending one. The SP setup wizard uses this so re-saving a step can't
 * pile up duplicate rows; the multi-add profile section keeps using addProfession/deleteChild.
 */
export async function setProfessions(userId: number, input: z.infer<typeof professionsSchema>) {
  const profile = await requireProfile(userId);
  // Resolve before opening the transaction — creating a pending master is its own write.
  const rows = [];
  for (const p of input.professions) {
    rows.push({
      profileId: profile.id,
      professionMasterId: await resolveProfessionMasterId(p),
      companyOrDetail: p.companyOrDetail,
    });
  }
  await prisma.$transaction([
    prisma.profileProfession.deleteMany({ where: { profileId: profile.id } }),
    prisma.profileProfession.createMany({ data: rows }),
  ]);
  await recomputeCompletion(profile.id);
  return prisma.profileProfession.findMany({
    where: { profileId: profile.id },
    include: { professionMaster: true },
  });
}

// ── Hobbies (admin master + self-suggesting) ─────────────────
export async function addHobby(userId: number, input: z.infer<typeof hobbySchema>) {
  const profile = await requireProfile(userId);
  let hobbyMasterId = input.hobbyMasterId;
  let customHobby: string | undefined;
  if (!hobbyMasterId && input.customHobby) {
    // Suggest a new (pending) hobby for admin approval, and link it.
    const master = await prisma.hobbiesMaster.upsert({
      where: { name: input.customHobby },
      update: {},
      create: { name: input.customHobby, isActive: false },
    });
    hobbyMasterId = master.id;
    customHobby = input.customHobby;
  }
  if (!hobbyMasterId) throw ApiError.badRequest('hobbyMasterId or customHobby required');
  return prisma.profileHobby.create({
    data: { profileId: profile.id, hobbyMasterId, customHobby },
    include: { hobbyMaster: true },
  });
}

// ── Family / Pets / Contacts ─────────────────────────────────
export async function addFamily(userId: number, input: z.infer<typeof familySchema>) {
  const profile = await requireProfile(userId);
  return prisma.profileFamily.create({ data: { profileId: profile.id, ...input } });
}

export async function addPet(userId: number, input: { name?: string; type?: string; breed?: string; age?: number; photoUrl?: string; videoUrl?: string }) {
  const profile = await requireProfile(userId);
  return prisma.profilePet.create({ data: { profileId: profile.id, ...input } });
}

export async function addContact(userId: number, input: z.infer<typeof contactSchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.profileContactDetail.create({ data: { profileId: profile.id, ...input } });
  await recomputeCompletion(profile.id);
  return row;
}

/** Deletes a child row that belongs to the user's profile. */
export async function deleteChild(
  userId: number,
  model: 'profileEducation' | 'profileProfession' | 'profileHobby' | 'profileFamily' | 'profilePet' | 'profileContactDetail' | 'spProduct' | 'spPaymentMethod' | 'profileMedia',
  id: number,
) {
  const profile = await requireProfile(userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[model];
  const row = await delegate.findUnique({ where: { id } });
  if (!row || row.profileId !== profile.id) throw ApiError.notFound();
  await delegate.delete({ where: { id } });
  if ((model === 'profilePet' || model === 'spProduct') && row.photoUrl) {
    void destroyByUrl(row.photoUrl, 'image');
  }
  if (model === 'profileMedia' && row.url) {
    void destroyByUrl(row.url, row.mediaType === 'video' ? 'video' : 'image');
  }
  await recomputeCompletion(profile.id);
  return { id, deleted: true };
}

// ── "Can offer help with" — heuristic suggestion ─────────────
export async function suggestOfferHelp(userId: number) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      professions: { include: { professionMaster: true } },
      hobbies: { include: { hobbyMaster: true } },
    },
  });
  if (!profile) throw ApiError.notFound('Profile not found');

  const skills: string[] = [];
  for (const p of profile.professions) if (p.professionMaster?.category) skills.push(p.professionMaster.category.toLowerCase());
  const hobbies = profile.hobbies
    .map((h) => h.hobbyMaster?.name ?? h.customHobby)
    .filter(Boolean) as string[];

  const parts: string[] = [];
  if (hobbies.length) parts.push(`sharing tips on ${hobbies.slice(0, 3).join(', ')}`);
  if (skills.length) parts.push(`guidance from my ${skills[0]} background`);
  parts.push('helping new neighbours settle in');

  const suggestion = `Happy to help with ${parts.join(', and ')}.`;
  return { suggestion };
}

// ── Service types (with custom "Other" → pending master) ─────
export async function setServiceTypes(userId: number, input: z.infer<typeof serviceTypesSchema>) {
  const profile = await requireProfile(userId);
  const ids = [...input.subcategoryIds];

  // Lazily resolve a fallback "Other" category for custom services without a categoryId.
  let otherCategoryId: number | undefined;
  const getOtherCategory = async () => {
    if (otherCategoryId) return otherCategoryId;
    const cat =
      (await prisma.serviceCategory.findFirst({ where: { name: 'Other' } })) ??
      (await prisma.serviceCategory.create({ data: { name: 'Other' } }));
    otherCategoryId = cat.id;
    return otherCategoryId;
  };

  for (const custom of input.customServices ?? []) {
    const categoryId = custom.categoryId ?? (await getOtherCategory());
    const existing = await prisma.serviceSubcategory.findFirst({
      where: { categoryId, name: custom.name },
    });
    const sub =
      existing ??
      (await prisma.serviceSubcategory.create({
        data: { categoryId, name: custom.name, isActive: false }, // pending admin approval
      }));
    ids.push(sub.id);
  }

  await prisma.$transaction([
    prisma.profileServiceType.deleteMany({ where: { profileId: profile.id } }),
    prisma.profileServiceType.createMany({
      data: Array.from(new Set(ids)).map((subcategoryId) => ({
        profileId: profile.id,
        subcategoryId,
        serviceNature: 'recurring',
      })),
    }),
  ]);
  await recomputeCompletion(profile.id);
  return prisma.profileServiceType.findMany({
    where: { profileId: profile.id },
    include: { subcategory: { include: { category: true } } },
  });
}

// ── SP dynamic subcategory fields (menu/rate cards etc.) ─────
/** The dynamic fields for the SP's selected subcategories, merged with their saved values. */
export async function getMyCustomFields(userId: number) {
  const profile = await requireProfile(userId);
  return getCustomFieldsForProfile(profile.id);
}

/** Replaces the SP's answers for the fields of their selected subcategories. */
export async function saveCustomFields(userId: number, values: { fieldId: number; value: string }[]) {
  const profile = await requireProfile(userId);

  const serviceTypes = await prisma.profileServiceType.findMany({
    where: { profileId: profile.id },
    select: { subcategoryId: true },
  });
  const subcategoryIds = Array.from(new Set(serviceTypes.map((s) => s.subcategoryId)));

  // Only accept fields that actually belong to the SP's selected subcategories.
  const validFields = await prisma.serviceSubcategoryField.findMany({
    where: { id: { in: values.map((v) => v.fieldId) }, subcategoryId: { in: subcategoryIds }, isActive: true },
    select: { id: true, isRequired: true, fieldName: true },
  });
  const validIds = new Set(validFields.map((f) => f.id));

  for (const f of validFields) {
    if (f.isRequired && !values.find((v) => v.fieldId === f.id)?.value?.trim()) {
      throw ApiError.badRequest(`${f.fieldName} is required`);
    }
  }

  const toSave = values.filter((v) => validIds.has(v.fieldId) && v.value.trim());
  await prisma.$transaction([
    prisma.spProfileCustomField.deleteMany({
      where: { profileId: profile.id, fieldId: { in: Array.from(validIds) } },
    }),
    prisma.spProfileCustomField.createMany({
      data: toSave.map((v) => ({ profileId: profile.id, fieldId: v.fieldId, fieldValue: v.value.trim() })),
    }),
  ]);
  await recomputeCompletion(profile.id);
  return getMyCustomFields(userId);
}

// ── SP products / delivery / payment ─────────────────────────
/// Rows for a product's customization menu, in the order the SP arranged them.
function customizationRows(list: z.infer<typeof productCustomizationSchema>[]) {
  return list.map((c, i) => ({
    label: c.label.trim(),
    inputType: c.inputType,
    isRequired: c.isRequired ?? false,
    sortOrder: i,
  }));
}

const withCustomizations = { customizations: { orderBy: { sortOrder: 'asc' } } } as const;

export async function addProduct(userId: number, input: z.infer<typeof productSchema>) {
  const profile = await requireProfile(userId);
  const { customizations, ...product } = input;
  const row = await prisma.spProduct.create({
    data: {
      profileId: profile.id,
      ...product,
      ...(customizations?.length ? { customizations: { create: customizationRows(customizations) } } : {}),
    },
    include: withCustomizations,
  });
  await recomputeCompletion(profile.id);
  return row;
}

export async function listMyProducts(userId: number) {
  const profile = await requireProfile(userId);
  return prisma.spProduct.findMany({
    where: { profileId: profile.id },
    orderBy: { sortOrder: 'asc' },
    include: withCustomizations,
  });
}

/// Labels this SP has already used on their other products — offered as suggestions so a
/// baker doesn't retype "Eggless" on all thirty cakes.
export async function myCustomizationLabels(userId: number) {
  const profile = await requireProfile(userId);
  const rows = await prisma.spProductCustomization.findMany({
    where: { product: { profileId: profile.id } },
    select: { label: true, inputType: true },
    distinct: ['label'],
    orderBy: { label: 'asc' },
  });
  return rows;
}

export async function updateProduct(
  userId: number,
  id: number,
  input: Partial<z.infer<typeof productSchema>>,
) {
  const profile = await requireProfile(userId);
  const row = await prisma.spProduct.findUnique({ where: { id } });
  if (!row || row.profileId !== profile.id) throw ApiError.notFound('Product not found');
  const { customizations, ...product } = input;
  // Replace-all only when the key is present — a PATCH that omits it leaves them alone.
  const updated = await prisma.spProduct.update({
    where: { id },
    data: {
      ...product,
      ...(customizations
        ? { customizations: { deleteMany: {}, create: customizationRows(customizations) } }
        : {}),
    },
    include: withCustomizations,
  });
  if (input.photoUrl !== undefined && input.photoUrl !== row.photoUrl && row.photoUrl) {
    void destroyByUrl(row.photoUrl, 'image');
  }
  return updated;
}

export async function setDelivery(userId: number, input: z.infer<typeof deliverySchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.spDeliveryPreference.upsert({
    where: { profileId: profile.id },
    update: input,
    create: { profileId: profile.id, ...input },
  });
  await recomputeCompletion(profile.id);
  return row;
}

// ── Availability (weekly template) + blackout dates ──────────
export async function getMyAvailability(userId: number) {
  const profile = await requireProfile(userId);
  const [availability, blackouts] = await Promise.all([
    prisma.spAvailability.findUnique({ where: { profileId: profile.id } }),
    prisma.spUnavailability.findMany({ where: { profileId: profile.id }, orderBy: { unavailableDate: 'asc' } }),
  ]);
  return { availability, blackouts };
}

export async function setAvailability(userId: number, input: z.infer<typeof availabilitySchema>) {
  const profile = await requireProfile(userId);
  const data = {
    workingDays: Array.from(new Set(input.workingDays)).sort((a, b) => a - b),
    startTime: input.startTime,
    endTime: input.endTime,
    slotMinutes: input.slotMinutes ?? null,
    willingToTravel: input.willingToTravel ?? false,
    maxTravelKm: input.maxTravelKm,
    horizonDays: input.horizonDays ?? 14,
  };
  return prisma.spAvailability.upsert({
    where: { profileId: profile.id },
    update: data,
    create: { profileId: profile.id, ...data },
  });
}

export async function addBlackout(userId: number, input: z.infer<typeof blackoutSchema>) {
  const profile = await requireProfile(userId);
  return prisma.spUnavailability.create({
    data: { profileId: profile.id, unavailableDate: dateOnly(input.unavailableDate), reason: input.reason },
  });
}

export async function listBlackouts(userId: number) {
  const profile = await requireProfile(userId);
  return prisma.spUnavailability.findMany({ where: { profileId: profile.id }, orderBy: { unavailableDate: 'asc' } });
}

export async function deleteBlackout(userId: number, id: number) {
  const profile = await requireProfile(userId);
  const row = await prisma.spUnavailability.findUnique({ where: { id } });
  if (!row || row.profileId !== profile.id) throw ApiError.notFound();
  await prisma.spUnavailability.delete({ where: { id } });
  return { id, deleted: true };
}

export async function setPaymentTerms(userId: number, input: z.infer<typeof paymentTermsSchema>) {
  const profile = await requireProfile(userId);
  return prisma.spPaymentTerm.upsert({
    where: { profileId: profile.id },
    update: input,
    create: { profileId: profile.id, ...input },
  });
}

export async function addPaymentMethod(userId: number, input: z.infer<typeof paymentMethodSchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.spPaymentMethod.create({ data: { profileId: profile.id, ...input } });
  await recomputeCompletion(profile.id);
  return row;
}

// ── Privacy settings ──────────────────────────────────────────
export async function getMyPrivacy(userId: number) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.findUnique({ where: { profileId: profile.id } });
  return { showCallButton: row?.showCallButton ?? false };
}

export async function setMyPrivacy(userId: number, input: { showCallButton: boolean }) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.upsert({
    where: { profileId: profile.id },
    update: { showCallButton: input.showCallButton },
    create: { profileId: profile.id, showCallButton: input.showCallButton },
  });
  return { showCallButton: row.showCallButton };
}

export async function getMyVisibility(userId: number) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.findUnique({ where: { profileId: profile.id } });
  return { profileVisibility: row?.profileVisibility ?? 'all', contactVisibility: row?.contactVisibility ?? 'only_me' };
}

export async function setMyVisibility(userId: number, input: z.infer<typeof visibilitySchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.upsert({
    where: { profileId: profile.id },
    update: { ...input },
    create: {
      profileId: profile.id,
      profileVisibility: input.profileVisibility ?? 'all',
      contactVisibility: input.contactVisibility ?? 'only_me',
    },
  });
  return { profileVisibility: row.profileVisibility, contactVisibility: row.contactVisibility };
}

const notificationPrefDefaults = {
  notifyApp: true,
  notifyWhatsapp: true,
  notifyEmail: true,
  alertMessages: true,
  alertOrders: true,
  alertPayments: true,
};

function pickNotificationPrefs(row: typeof notificationPrefDefaults | null | undefined) {
  return row
    ? {
        notifyApp: row.notifyApp,
        notifyWhatsapp: row.notifyWhatsapp,
        notifyEmail: row.notifyEmail,
        alertMessages: row.alertMessages,
        alertOrders: row.alertOrders,
        alertPayments: row.alertPayments,
      }
    : notificationPrefDefaults;
}

export async function getMyNotificationPrefs(userId: number) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.findUnique({ where: { profileId: profile.id } });
  return pickNotificationPrefs(row);
}

export async function setMyNotificationPrefs(userId: number, input: z.infer<typeof notificationPrefsSchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.profilePrivacySetting.upsert({
    where: { profileId: profile.id },
    update: { ...input },
    create: { profileId: profile.id, ...notificationPrefDefaults, ...input },
  });
  return pickNotificationPrefs(row);
}

// ── Completion tracking ──────────────────────────────────────
export async function recomputeCompletion(profileId: number) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      user: { select: { userType: true } },
      address: { include: { verificationDocs: true } },
      _count: {
        select: {
          educations: true,
          professions: true,
          contactDetails: true,
          serviceTypes: true,
          products: true,
          rates: true,
          paymentMethods: true,
        },
      },
      delivery: true,
    },
  });
  if (!profile) return;

  const isSP = profile.user.userType === 'service_provider';
  const kind = isSP ? await resolveProviderKind(profileId) : 'service';
  const isService = kind === 'service';
  const flags = {
    hasPhoto: !!profile.photoUrl,
    hasAddress: !!profile.addressId,
    hasAddressVerified: !!profile.address?.verificationDocs.some((d) => d.status === 'approved'),
    hasEducation: profile._count.educations > 0,
    hasProfession: profile._count.professions > 0,
    hasContactDetails: profile._count.contactDetails > 0,
    hasServiceTypes: profile._count.serviceTypes > 0,
    // For a service SP, "catalogue" completion means published rates; delivery prefs don't apply.
    hasProducts: isService ? profile._count.rates > 0 : profile._count.products > 0,
    hasDeliveryPrefs: !!profile.delivery,
    hasPaymentMethods: profile._count.paymentMethods > 0,
  };

  const applicable = isSP
    ? isService
      ? ['hasPhoto', 'hasAddress', 'hasEducation', 'hasProfession', 'hasContactDetails', 'hasServiceTypes', 'hasProducts', 'hasPaymentMethods']
      : ['hasPhoto', 'hasAddress', 'hasEducation', 'hasProfession', 'hasContactDetails', 'hasServiceTypes', 'hasProducts', 'hasDeliveryPrefs', 'hasPaymentMethods']
    : ['hasPhoto', 'hasAddress', 'hasEducation', 'hasProfession', 'hasContactDetails'];
  const filled = applicable.filter((k) => flags[k as keyof typeof flags]).length;
  const completionPercent = Math.round((filled / applicable.length) * 100);

  await prisma.profileCompletionTracking.upsert({
    where: { profileId },
    update: { ...flags, completionPercent, lastComputedAt: new Date() },
    create: { profileId, ...flags, completionPercent, lastComputedAt: new Date() },
  });

  return { ...flags, completionPercent };
}
