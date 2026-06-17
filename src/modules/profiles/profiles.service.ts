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

export async function setPhoto(userId: number, photoUrl: string) {
  const profile = await requireProfile(userId);
  const updated = await prisma.profile.update({ where: { id: profile.id }, data: { photoUrl } });
  await recomputeCompletion(profile.id);
  return updated;
}

// ── Education (self-adding master) ───────────────────────────
export async function addEducation(userId: number, input: z.infer<typeof educationSchema>) {
  const profile = await requireProfile(userId);
  let educationMasterId = input.educationMasterId;
  if (!educationMasterId) {
    const master = await prisma.educationMaster.create({
      data: {
        degree: input.degree,
        schoolName: input.schoolName,
        schoolCity: input.schoolCity,
        collegeName: input.collegeName,
        collegeCity: input.collegeCity,
        postGradCollege: input.postGradCollege,
        postGradCity: input.postGradCity,
      },
    });
    educationMasterId = master.id;
  }
  const row = await prisma.profileEducation.create({
    data: { profileId: profile.id, educationMasterId },
    include: { educationMaster: true },
  });
  await recomputeCompletion(profile.id);
  return row;
}

// ── Profession (self-adding category) ────────────────────────
export async function addProfession(userId: number, input: z.infer<typeof professionSchema>) {
  const profile = await requireProfile(userId);
  let professionMasterId = input.professionMasterId;
  if (!professionMasterId && input.category) {
    const existing = await prisma.professionMaster.findFirst({ where: { category: input.category } });
    professionMasterId =
      existing?.id ?? (await prisma.professionMaster.create({ data: { category: input.category } })).id;
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
