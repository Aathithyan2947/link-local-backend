import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import type { CreateAddressInput } from './addresses.schema.js';

/** Resolves an area id from the payload, creating one under the city if needed. */
async function resolveAreaId(input: CreateAddressInput): Promise<number> {
  if (input.areaId) {
    const area = await prisma.area.findUnique({ where: { id: input.areaId } });
    if (!area) throw ApiError.badRequest('Invalid areaId');
    return area.id;
  }
  const city = await prisma.city.findUnique({ where: { id: input.cityId } });
  if (!city) throw ApiError.badRequest('Invalid cityId');

  const areaName = input.areaName?.trim() || input.suburb?.trim() || 'General';
  const existing = await prisma.area.findFirst({
    where: { cityId: input.cityId, areaName, pincode: input.pincode ?? null },
  });
  if (existing) return existing.id;

  const created = await prisma.area.create({
    data: { cityId: input.cityId, areaName, suburb: input.suburb, pincode: input.pincode },
  });
  return created.id;
}

export async function createAddressForUser(userId: number, input: CreateAddressInput) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw ApiError.notFound('Profile not found');

  const areaId = await resolveAreaId(input);

  const address = await prisma.address.create({
    data: {
      areaId,
      flatWing: input.flatWing,
      apartment: input.apartment,
      lane1: input.lane1,
      lane2: input.lane2,
      fullAddress: input.fullAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      // New user-submitted addresses are flagged for admin screening (PRD):
      // they show as Inactive in Address Capture until an admin validates/activates.
      isActive: false,
    },
  });

  await prisma.profile.update({ where: { id: profile.id }, data: { addressId: address.id } });

  // Ensure a city membership row exists (primary city).
  await prisma.userCityMembership.upsert({
    where: { userId_cityId: { userId, cityId: input.cityId } },
    update: {},
    create: { userId, cityId: input.cityId, isPrimary: true },
  });

  return prisma.address.findUnique({
    where: { id: address.id },
    include: { area: { include: { city: true } }, verificationDocs: true },
  });
}

export async function getMyAddress(userId: number) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      address: { include: { area: { include: { city: true } }, verificationDocs: true } },
    },
  });
  return profile?.address ?? null;
}

export async function addVerificationDoc(params: {
  userId: number;
  docType: string;
  docUrl: string;
}) {
  const address = await getMyAddress(params.userId);
  if (!address) throw ApiError.badRequest('Add an address before uploading proof');

  return prisma.addressVerificationDoc.create({
    data: {
      addressId: address.id,
      cityId: address.area.cityId,
      docType: params.docType,
      docUrl: params.docUrl,
      status: 'pending',
    },
  });
}

/** Directory search powering the app's address autocomplete (localities + known complexes). */
export async function searchDirectory(q: string) {
  const term = q.trim();
  if (term.length < 2) return { localities: [], complexes: [] };

  const [areas, complexRows] = await Promise.all([
    prisma.area.findMany({
      where: { areaName: { contains: term, mode: 'insensitive' } },
      include: { city: { select: { name: true, state: true } } },
      orderBy: { areaName: 'asc' },
      take: 10,
    }),
    prisma.address.findMany({
      where: { apartment: { contains: term, mode: 'insensitive' } },
      select: {
        apartment: true,
        lane1: true,
        lane2: true,
        area: { select: { id: true, areaName: true, suburb: true, pincode: true, cityId: true, city: { select: { name: true } } } },
      },
      distinct: ['apartment'],
      orderBy: { apartment: 'asc' },
      take: 12,
    }),
  ]);

  return {
    localities: areas.map((a) => ({
      areaId: a.id,
      cityId: a.cityId,
      areaName: a.areaName,
      suburb: a.suburb,
      pincode: a.pincode,
      city: a.city.name,
    })),
    complexes: complexRows.map((c) => ({
      apartment: c.apartment,
      lane1: c.lane1,
      locality: c.lane2 ?? c.area.areaName,
      areaId: c.area.id,
      cityId: c.area.cityId,
      pincode: c.area.pincode,
      city: c.area.city.name,
    })),
  };
}

/** Admin: list address-proof documents for review. */
export async function listAddressDocs(params: { page: number; pageSize: number; status?: string }) {
  const where: Record<string, unknown> = {};
  if (params.status && params.status !== 'all') where.status = params.status;

  const [rows, total] = await Promise.all([
    prisma.addressVerificationDoc.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        address: {
          include: {
            area: { include: { city: { select: { name: true } } } },
            profiles: { select: { name: true, user: { select: { id: true, mobile: true } } } },
          },
        },
      },
    }),
    prisma.addressVerificationDoc.count({ where }),
  ]);

  const items = rows.map((d) => ({
    id: d.id,
    docType: d.docType,
    docUrl: d.docUrl,
    status: d.status ?? 'pending',
    createdAt: d.createdAt,
    userName: d.address.profiles[0]?.name ?? '—',
    userId: d.address.profiles[0]?.user.id ?? null,
    fullAddress: d.address.fullAddress,
    city: d.address.area.city.name,
  }));
  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

export async function reviewAddressDoc(docId: number, status: 'approved' | 'rejected', adminId: number) {
  const doc = await prisma.addressVerificationDoc.update({
    where: { id: docId },
    data: { status, reviewedBy: adminId, reviewedAt: new Date() },
    include: { address: { include: { profiles: true } } },
  });
  return doc;
}

/** Admin "Address Capture" listing — addresses with their Active/Inactive flag. */
export async function listAddresses(
  params: PaginationParams & { q?: string; status?: string },
) {
  const where: Record<string, unknown> = {};
  if (params.q) {
    where.OR = [
      { fullAddress: { contains: params.q, mode: 'insensitive' } },
      { apartment: { contains: params.q, mode: 'insensitive' } },
      { area: { areaName: { contains: params.q, mode: 'insensitive' } } },
      { area: { pincode: { contains: params.q, mode: 'insensitive' } } },
      { profiles: { some: { name: { contains: params.q, mode: 'insensitive' } } } },
    ];
  }
  if (params.status === 'active') where.isActive = true;
  else if (params.status === 'inactive') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.address.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toPrismaPagination(params),
      include: {
        area: { include: { city: { select: { name: true, state: true } } } },
        profiles: { select: { id: true, name: true, user: { select: { id: true, mobile: true } } } },
      },
    }),
    prisma.address.count({ where }),
  ]);

  const items = rows.map((a) => {
    const owner = a.profiles[0];
    return {
      id: a.id,
      userName: owner?.name ?? '—',
      userId: owner?.user.id ?? null,
      mobile: owner?.user.mobile ?? null,
      fullAddress: a.fullAddress,
      areaName: a.area.areaName,
      pincode: a.area.pincode,
      city: a.area.city.name,
      isActive: a.isActive,
      createdAt: a.createdAt,
    };
  });

  return { items, meta: buildMeta(params.page, params.pageSize, total) };
}

/** Toggle an address Active/Inactive. */
export async function setAddressActive(id: number, isActive: boolean) {
  return prisma.address.update({
    where: { id },
    data: { isActive },
    select: { id: true, isActive: true },
  });
}

// ── Per-city address-form configuration (PRD) ────────────────
export interface AddressFieldConfig {
  fieldKey: string;
  label: string;
  isRequired: boolean;
  isVisible: boolean;
  sortOrder: number;
}

/** Canonical address fields + sensible defaults (used when a city has no config). */
export const DEFAULT_ADDRESS_FIELDS: AddressFieldConfig[] = [
  { fieldKey: 'flat_wing', label: 'Flat No. / Wing / House / Plot', isRequired: true, isVisible: true, sortOrder: 1 },
  { fieldKey: 'building', label: 'Building / Apartment name', isRequired: false, isVisible: true, sortOrder: 2 },
  { fieldKey: 'lane1', label: 'Lane 1', isRequired: false, isVisible: true, sortOrder: 3 },
  { fieldKey: 'lane2', label: 'Lane 2', isRequired: false, isVisible: true, sortOrder: 4 },
  { fieldKey: 'area', label: 'Area', isRequired: true, isVisible: true, sortOrder: 5 },
  { fieldKey: 'suburb', label: 'Suburb', isRequired: false, isVisible: true, sortOrder: 6 },
  { fieldKey: 'pincode', label: 'Pincode', isRequired: true, isVisible: true, sortOrder: 7 },
];

/** Effective field config for a city — its saved rows, or the defaults if none. */
export async function getCityAddressFields(cityId: number): Promise<AddressFieldConfig[]> {
  const rows = await prisma.cityAddressField.findMany({
    where: { cityId },
    orderBy: { sortOrder: 'asc' },
  });
  if (rows.length === 0) return DEFAULT_ADDRESS_FIELDS;
  return rows.map((r) => ({
    fieldKey: r.fieldKey,
    label: r.label,
    isRequired: r.isRequired,
    isVisible: r.isVisible,
    sortOrder: r.sortOrder,
  }));
}

/** Replaces a city's address-form config. */
export async function saveCityAddressFields(cityId: number, fields: AddressFieldConfig[]) {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city) throw ApiError.badRequest('Invalid cityId');

  await prisma.$transaction([
    prisma.cityAddressField.deleteMany({ where: { cityId } }),
    prisma.cityAddressField.createMany({
      data: fields.map((f, i) => ({
        cityId,
        fieldKey: f.fieldKey,
        label: f.label,
        isRequired: f.isRequired ?? false,
        isVisible: f.isVisible ?? true,
        sortOrder: f.sortOrder ?? i + 1,
      })),
    }),
  ]);
  return getCityAddressFields(cityId);
}

/**
 * Bulk-import addresses from a parsed spreadsheet. Each row maps the source-sheet
 * headers (Complex name / Lane 1 / Lane 2 / Area / Suburb / City / Pincode) to
 * City → Area(locality) → Address, reusing the directory seed shape.
 */
export async function importAddresses(
  rows: Array<Record<string, unknown>>,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  const pick = (r: Record<string, unknown>, keys: string[]): string => {
    for (const k of Object.keys(r)) {
      if (keys.some((want) => k.trim().toLowerCase() === want)) {
        const v = r[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  };

  const cityCache = new Map<string, number>();
  const areaCache = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const complex = pick(r, ['complex name', 'complex', 'apartment', 'building']);
    const lane1 = pick(r, ['lane 1', 'lane1']);
    const locality = pick(r, ['lane 2', 'lane2', 'locality']);
    const area = pick(r, ['area']);
    const suburb = pick(r, ['suburb']);
    const cityName = pick(r, ['city']);
    const pincode = pick(r, ['pincode', 'pin code', 'zip']);

    if (!cityName || !complex) {
      skipped++;
      continue;
    }

    try {
      // City
      let cityId = cityCache.get(cityName.toLowerCase());
      if (!cityId) {
        const existing = await prisma.city.findFirst({ where: { name: cityName } });
        cityId = existing?.id ?? (await prisma.city.create({ data: { name: cityName } })).id;
        cityCache.set(cityName.toLowerCase(), cityId);
      }

      // Area (locality preferred, else the Area column, else "General")
      const areaName = locality || area || 'General';
      const areaKey = `${cityId}|${areaName.toLowerCase()}|${suburb.toLowerCase()}`;
      let areaId = areaCache.get(areaKey);
      if (!areaId) {
        const existing = await prisma.area.findFirst({
          where: { cityId, areaName, suburb: suburb || null },
        });
        areaId =
          existing?.id ??
          (await prisma.area.create({
            data: { cityId, areaName, suburb: suburb || undefined, pincode: pincode || undefined },
          })).id;
        areaCache.set(areaKey, areaId);
      }

      const fullAddress = [complex, lane1, locality, area, suburb, cityName, pincode]
        .filter(Boolean)
        .join(', ');

      await prisma.address.create({
        data: {
          areaId,
          apartment: complex,
          lane1: lane1 || undefined,
          lane2: locality || undefined,
          fullAddress,
        },
      });
      created++;
    } catch (e) {
      skipped++;
      if (errors.length < 5) errors.push(`Row ${i + 2}: ${(e as Error).message}`);
    }
  }

  return { created, skipped, errors };
}
