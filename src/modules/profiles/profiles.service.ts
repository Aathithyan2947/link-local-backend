import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { z } from 'zod';
import type {
  contactSchema,
  deliverySchema,
  educationSchema,
  familySchema,
  hobbySchema,
  paymentMethodSchema,
  paymentTermsSchema,
  productSchema,
  professionSchema,
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
      delivery: true,
      paymentTerms: true,
      paymentMethods: true,
      completion: true,
    },
  });
  if (!profile) throw ApiError.notFound('Profile not found');
  return profile;
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
  model: 'profileEducation' | 'profileProfession' | 'profileHobby' | 'profileFamily' | 'profilePet' | 'profileContactDetail' | 'spProduct' | 'spPaymentMethod',
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
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: { serviceTypes: { select: { subcategoryId: true } } },
  });
  if (!profile) throw ApiError.notFound('Profile not found');

  const subcategoryIds = Array.from(new Set(profile.serviceTypes.map((s) => s.subcategoryId)));
  if (subcategoryIds.length === 0) return [];

  const fields = await prisma.serviceSubcategoryField.findMany({
    where: { subcategoryId: { in: subcategoryIds }, isActive: true },
    orderBy: [{ subcategoryId: 'asc' }, { sortOrder: 'asc' }],
    include: { subcategory: { select: { name: true } } },
  });
  const values = await prisma.spProfileCustomField.findMany({
    where: { profileId: profile.id, fieldId: { in: fields.map((f) => f.id) } },
  });
  const valueByField = new Map(values.map((v) => [v.fieldId, v.fieldValue]));

  return fields.map((f) => ({
    fieldId: f.id,
    subcategoryId: f.subcategoryId,
    subcategoryName: f.subcategory.name,
    fieldName: f.fieldName,
    fieldType: f.fieldType,
    fieldOptions: f.fieldOptions,
    isRequired: f.isRequired,
    sortOrder: f.sortOrder,
    value: valueByField.get(f.id) ?? '',
  }));
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
          paymentMethods: true,
        },
      },
      delivery: true,
    },
  });
  if (!profile) return;

  const isSP = profile.user.userType === 'service_provider';
  const flags = {
    hasPhoto: !!profile.photoUrl,
    hasAddress: !!profile.addressId,
    hasAddressVerified: !!profile.address?.verificationDocs.some((d) => d.status === 'approved'),
    hasEducation: profile._count.educations > 0,
    hasProfession: profile._count.professions > 0,
    hasContactDetails: profile._count.contactDetails > 0,
    hasServiceTypes: profile._count.serviceTypes > 0,
    hasProducts: profile._count.products > 0,
    hasDeliveryPrefs: !!profile.delivery,
    hasPaymentMethods: profile._count.paymentMethods > 0,
  };

  const applicable = isSP
    ? ['hasPhoto', 'hasAddress', 'hasEducation', 'hasProfession', 'hasContactDetails', 'hasServiceTypes', 'hasProducts', 'hasDeliveryPrefs', 'hasPaymentMethods']
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
