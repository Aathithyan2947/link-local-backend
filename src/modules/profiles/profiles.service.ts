import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { dateOnly } from '../../lib/slots.js';
import { resolveProviderKind, resolveProviderFeatures } from '../../lib/providerKind.js';
import { getCustomFieldsForProfile } from '../../lib/customFields.js';
import type { z } from 'zod';
import type {
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
  productSchema,
  professionSchema,
  reportProfileSchema,
  serviceTypesSchema,
  updateProfileSchema,
} from './profiles.schema.js';

/** Returns the profile row for a user, or throws 404. */
async function requireProfile(userId: number) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw ApiError.notFound('Profile not found');
  return profile;
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
      products: { orderBy: { sortOrder: 'asc' } },
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

/** Public profile view (the "User" frame) — any member viewing another member. */
export async function getPublicProfile(profileId: number) {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      user: { select: { id: true, userType: true, mobile: true } },
      address: { include: { area: { include: { city: true } } } },
      educations: { include: { educationMaster: true } },
      professions: { include: { professionMaster: true } },
    },
  });
  if (!profile) throw ApiError.notFound('Profile not found');
  const userId = profile.userId;

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
  const events = [
    ...hosted.map((e) => ({ ...e, relation: 'hosting' as const })),
    ...attending.filter((e) => !hostedIds.has(e.id)).map((e) => ({ ...e, relation: 'attending' as const })),
  ];
  const adminGroupIds = new Set(adminGroups.map((a) => a.groupId));
  const groups = [
    ...adminGroups.map((a) => ({ ...a.group, role: 'admin' as const })),
    ...memberGroups.filter((m) => !adminGroupIds.has(m.groupId)).map((m) => ({ ...m.group, role: 'member' as const })),
  ];

  return { ...profile, events, posts, groups, servicesContacted };
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
  const updated = await prisma.profile.update({ where: { id: profile.id }, data: { photoUrl } });
  await recomputeCompletion(profile.id);
  return updated;
}

export async function updateEmail(userId: number, email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.id !== userId) throw ApiError.badRequest('That email is already in use.');
  return prisma.user.update({ where: { id: userId }, data: { email }, select: { id: true, email: true } });
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
  const row = await prisma.profileEducation.create({
    data: {
      profileId: profile.id,
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
    },
    include: { educationMaster: true },
  });
  await recomputeCompletion(profile.id);
  return row;
}

// ── Profession (curated category + self-suggested "Other") ──────
export async function addProfession(userId: number, input: z.infer<typeof professionSchema>) {
  const profile = await requireProfile(userId);
  let professionMasterId = input.professionMasterId;
  if (!professionMasterId && input.category) {
    const category = input.category.trim();
    // Reuse an existing category (case-insensitive, any status) to avoid duplicate pendings;
    // a brand-new "Other" category is queued as pending (isActive=false) for admin approval.
    const existing = await prisma.professionMaster.findFirst({
      where: { category: { equals: category, mode: 'insensitive' } },
    });
    professionMasterId =
      existing?.id ??
      (await prisma.professionMaster.create({ data: { category, isActive: false } })).id;
  }
  if (!professionMasterId) throw ApiError.badRequest('professionMasterId or category required');
  const row = await prisma.profileProfession.create({
    data: { profileId: profile.id, professionMasterId, companyOrDetail: input.companyOrDetail },
    include: { professionMaster: true },
  });
  await recomputeCompletion(profile.id);
  return row;
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
export async function addProduct(userId: number, input: z.infer<typeof productSchema>) {
  const profile = await requireProfile(userId);
  const row = await prisma.spProduct.create({ data: { profileId: profile.id, ...input } });
  await recomputeCompletion(profile.id);
  return row;
}

export async function listMyProducts(userId: number) {
  const profile = await requireProfile(userId);
  return prisma.spProduct.findMany({ where: { profileId: profile.id }, orderBy: { sortOrder: 'asc' } });
}

export async function updateProduct(
  userId: number,
  id: number,
  input: Partial<z.infer<typeof productSchema>>,
) {
  const profile = await requireProfile(userId);
  const row = await prisma.spProduct.findUnique({ where: { id } });
  if (!row || row.profileId !== profile.id) throw ApiError.notFound('Product not found');
  return prisma.spProduct.update({ where: { id }, data: input });
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
