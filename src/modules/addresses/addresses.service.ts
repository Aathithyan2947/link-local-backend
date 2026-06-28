import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type PaginationParams, toPrismaPagination } from '../../utils/pagination.js';
import type {
  CreateAddressInput,
  CreateMasterInput,
  UpdateMasterInput,
} from './addresses.schema.js';

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

  // The user's private address keeps their building/flat + exact pin; it is usable
  // immediately (no admin gate). The shared locality is queued into the Address Master
  // separately, where it waits for approval before being suggested to other users.
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
    },
  });

  await prisma.profile.update({ where: { id: profile.id }, data: { addressId: address.id } });

  // Ensure a city membership row exists (primary city).
  await prisma.userCityMembership.upsert({
    where: { userId_cityId: { userId, cityId: input.cityId } },
    update: {},
    create: { userId, cityId: input.cityId, isPrimary: true },
  });

  // Feed the locality (building/complex name + lane/area, never the flat) into the Address
  // Master — reuse an approved match or queue a new pending one. Never blocks the user.
  // The complex name is included so a brand-new "Other" building the user types is captured
  // and surfaces in the admin for verification/approval (instead of silently dropped).
  await upsertMasterFromSubmission({
    cityId: input.cityId,
    complex: input.apartment,
    lane1: input.lane1,
    lane2: input.lane2,
    area: input.areaName,
    suburb: input.suburb,
    pincode: input.pincode,
    latitude: input.latitude,
    longitude: input.longitude,
    userId,
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
  description?: string;
}) {
  const address = await getMyAddress(params.userId);
  if (!address) throw ApiError.badRequest('Add an address before uploading proof');

  return prisma.addressVerificationDoc.create({
    data: {
      addressId: address.id,
      cityId: address.area.cityId,
      docType: params.docType,
      description: params.description,
      docUrl: params.docUrl,
      status: 'pending',
    },
  });
}

/**
 * Guarantees the "Other" document type is enabled for a city (idempotent). "Other" is always
 * available to members in every city, and any "Other" proof always goes through admin
 * verification (uploaded as pending). Existing rows are left as-is so an admin can still
 * deactivate it deliberately.
 */
export async function ensureCityOtherDocType(cityId: number) {
  await prisma.cityAllowedDocType.upsert({
    where: { cityId_docType: { cityId, docType: 'other' } },
    update: {},
    create: { cityId, docType: 'other', isActive: true },
  });
}

/**
 * Deletes a city safely. Admin-only config rows (allowed doc types, address-form fields) are
 * removed first so an otherwise-empty city can be deleted; if the city still has real data
 * (areas, members, addresses, master localities), the FK blocks it and we surface a clear
 * message asking the admin to deactivate it instead of a 500 / broken page.
 */
export async function deleteCity(cityId: number) {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city) throw ApiError.notFound('City not found');

  try {
    // Atomic: if the city can't be deleted (real data still references it), the config
    // deletions roll back too — so a blocked delete never wipes the city's doc types / form.
    await prisma.$transaction(async (tx) => {
      await tx.cityAllowedDocType.deleteMany({ where: { cityId } });
      await tx.cityAddressField.deleteMany({ where: { cityId } });
      await tx.city.delete({ where: { id: cityId } });
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = String((e as { message?: string }).message ?? '');
    const isFk = code === 'P2003' || code === 'P2014' || /foreign key|constraint|violates|2350[0-9]|23001/i.test(msg);
    if (isFk) {
      throw ApiError.conflict(
        "This city has members, areas or addresses linked to it, so it can't be deleted. Deactivate it instead.",
      );
    }
    throw e;
  }
  return { id: cityId, deleted: true };
}

/**
 * Directory autocomplete powering the app's address search. Suggestions come ONLY from the
 * approved Address Master (deduped localities/lanes) — never from per-user building names.
 */
export async function searchDirectory(q: string) {
  const term = q.trim();
  if (term.length < 2) return { localities: [] };

  const rows = await prisma.addressMaster.findMany({
    where: {
      status: 'approved',
      OR: [
        { complex: { contains: term, mode: 'insensitive' } },
        { lane1: { contains: term, mode: 'insensitive' } },
        { lane2: { contains: term, mode: 'insensitive' } },
        { area: { contains: term, mode: 'insensitive' } },
        { suburb: { contains: term, mode: 'insensitive' } },
        { pincode: { contains: term, mode: 'insensitive' } },
      ],
    },
    include: { city: { select: { name: true, state: true } } },
    orderBy: [{ complex: 'asc' }, { lane2: 'asc' }, { lane1: 'asc' }],
    take: 15,
  });

  return {
    localities: rows.map((m) => ({
      masterId: m.id,
      cityId: m.cityId,
      // Building/complex name — the app fills this into the building field on selection.
      complex: m.complex,
      lane1: m.lane1,
      lane2: m.lane2,
      area: m.area,
      suburb: m.suburb,
      pincode: m.pincode,
      latitude: m.latitude ? Number(m.latitude) : null,
      longitude: m.longitude ? Number(m.longitude) : null,
      city: m.city.name,
      state: m.city.state,
    })),
  };
}

// ── Address Master: geo lookup + submission queue ────────────
const EARTH_RADIUS_KM = 6371;

export interface NearbyMaster {
  masterId: number;
  cityId: number;
  lane1: string | null;
  lane2: string | null;
  area: string | null;
  suburb: string | null;
  pincode: string | null;
  city: string;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number;
}

/**
 * Maps a GPS pin to the nearest APPROVED Address Master localities within `radiusKm`
 * (default 2 km), nearest first. Uses a Haversine raw query with a bounding-box pre-filter
 * so it works on plain PostgreSQL (no PostGIS).
 */
export async function findNearbyMaster(
  lat: number,
  lng: number,
  radiusKm = 2,
): Promise<NearbyMaster[]> {
  // Bounding box to let the planner use the lat/lng before computing Haversine.
  const latDelta = radiusKm / 111.32; // ~km per degree latitude
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusKm / (111.32 * (Math.abs(cosLat) < 1e-6 ? 1e-6 : cosLat));

  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      city_id: number;
      lane1: string | null;
      lane2: string | null;
      area: string | null;
      suburb: string | null;
      pincode: string | null;
      latitude: string | null;
      longitude: string | null;
      city_name: string;
      state: string | null;
      distance_km: number;
    }>
  >`
    SELECT * FROM (
      SELECT m.id, m.city_id, m.lane1, m.lane2, m.area, m.suburb, m.pincode,
             m.latitude, m.longitude, c.name AS city_name, c.state,
             ${EARTH_RADIUS_KM} * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(CAST(m.latitude AS DOUBLE PRECISION) - ${lat}) / 2), 2) +
               COS(RADIANS(${lat})) * COS(RADIANS(CAST(m.latitude AS DOUBLE PRECISION))) *
               POWER(SIN(RADIANS(CAST(m.longitude AS DOUBLE PRECISION) - ${lng}) / 2), 2)
             )) AS distance_km
      FROM address_master m
      JOIN cities c ON c.id = m.city_id
      WHERE m.status = 'approved'
        AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
        AND CAST(m.latitude AS DOUBLE PRECISION) BETWEEN ${lat - latDelta} AND ${lat + latDelta}
        AND CAST(m.longitude AS DOUBLE PRECISION) BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
    ) sub
    WHERE sub.distance_km <= ${radiusKm}
    ORDER BY sub.distance_km ASC
    LIMIT 5
  `;

  return rows.map((r) => ({
    masterId: r.id,
    cityId: r.city_id,
    lane1: r.lane1,
    lane2: r.lane2,
    area: r.area,
    suburb: r.suburb,
    pincode: r.pincode,
    city: r.city_name,
    state: r.state,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    distanceKm: Number(r.distance_km),
  }));
}

interface MasterSubmission {
  cityId: number;
  complex?: string;
  lane1?: string;
  lane2?: string;
  area?: string;
  suburb?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  userId?: number;
}

/**
 * Reuses an existing Address Master row that already covers this locality (whether it's
 * approved OR still pending), otherwise queues a new PENDING entry for admin approval.
 * Pending entries are not suggested/autofilled until approved. De-duplication is by:
 *   (a) a nearby APPROVED entry within ~0.3 km (same city), or
 *   (b) a case-insensitive match on the full locality key
 *       (lane1 + lane2 + area + suburb + pincode) in the same city, ANY status.
 * This guarantees only genuinely-new localities are ever inserted — identical or
 * same-locality submissions (regardless of letter-casing or trailing spaces) reuse the
 * existing row instead of creating a duplicate. Returns the matched/created master, or
 * null when there isn't enough locality information to record.
 */
export async function upsertMasterFromSubmission(input: MasterSubmission) {
  const norm = (s?: string) => s?.trim() || undefined;
  const complex = norm(input.complex);
  const lane1 = norm(input.lane1);
  const lane2 = norm(input.lane2);
  const area = norm(input.area);
  const suburb = norm(input.suburb);
  const pincode = norm(input.pincode);

  // Nothing meaningful to record as a locality.
  if (!complex && !lane1 && !lane2 && !area && !suburb) return null;

  // (a) Geographic match: an approved locality within ~0.3 km is the same place.
  if (input.latitude != null && input.longitude != null) {
    const near = await findNearbyMaster(input.latitude, input.longitude, 0.3);
    const sameCity = near.find((n) => n.cityId === input.cityId);
    if (sameCity) return prisma.addressMaster.findUnique({ where: { id: sameCity.masterId } });
  }

  // (b) Attribute match on the full locality key, case-insensitive, across ANY status.
  // A field absent in the submission must match a NULL value in the row.
  const eq = (v?: string) => (v == null ? null : { equals: v, mode: 'insensitive' as const });
  const existing = await prisma.addressMaster.findFirst({
    where: {
      cityId: input.cityId,
      complex: eq(complex),
      lane1: eq(lane1),
      lane2: eq(lane2),
      area: eq(area),
      suburb: eq(suburb),
      pincode: eq(pincode),
    },
  });
  if (existing) return existing;

  // (c) Genuinely new locality → queue as pending for admin approval.
  return prisma.addressMaster.create({
    data: {
      cityId: input.cityId,
      complex,
      lane1,
      lane2,
      area,
      suburb,
      pincode,
      latitude: input.latitude,
      longitude: input.longitude,
      status: 'pending',
      source: 'user',
      submittedBy: input.userId,
    },
  });
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
    description: d.description,
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

  // Keep the member's verification status in sync with their address proofs: a member is
  // verified only while at least one APPROVED proof exists. So approving verifies them, and
  // rejecting un-verifies them (unless another approved proof remains). Re-uploading a fresh
  // proof after a rejection creates a new pending doc that can be approved to re-verify.
  const approvedCount = await prisma.addressVerificationDoc.count({
    where: { addressId: doc.addressId, status: 'approved' },
  });
  const userIds = doc.address.profiles.map((p) => p.userId);
  if (userIds.length) {
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { isVerified: approvedCount > 0 },
    });
  }
  return doc;
}

// ── Admin: Address Master management ─────────────────────────

function masterToItem(m: {
  id: number;
  complex: string | null;
  lane1: string | null;
  lane2: string | null;
  area: string | null;
  suburb: string | null;
  pincode: string | null;
  latitude: unknown;
  longitude: unknown;
  status: string;
  source: string;
  createdAt: Date;
  city: { name: string; state: string | null };
}) {
  return {
    id: m.id,
    complex: m.complex,
    lane1: m.lane1,
    lane2: m.lane2,
    area: m.area,
    suburb: m.suburb,
    pincode: m.pincode,
    latitude: m.latitude != null ? Number(m.latitude) : null,
    longitude: m.longitude != null ? Number(m.longitude) : null,
    status: m.status,
    source: m.source,
    city: m.city.name,
    state: m.city.state,
    createdAt: m.createdAt,
  };
}

/**
 * Admin "Address Master" listing — deduped localities with their approval status.
 * Intentionally exposes NO user / building / flat information.
 */
export async function listMaster(params: PaginationParams & { q?: string; status?: string }) {
  const where: Record<string, unknown> = {};
  if (params.status && params.status !== 'all') where.status = params.status;
  if (params.q) {
    where.OR = [
      { complex: { contains: params.q, mode: 'insensitive' } },
      { lane1: { contains: params.q, mode: 'insensitive' } },
      { lane2: { contains: params.q, mode: 'insensitive' } },
      { area: { contains: params.q, mode: 'insensitive' } },
      { suburb: { contains: params.q, mode: 'insensitive' } },
      { pincode: { contains: params.q, mode: 'insensitive' } },
      { city: { name: { contains: params.q, mode: 'insensitive' } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.addressMaster.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      ...toPrismaPagination(params),
      include: { city: { select: { name: true, state: true } } },
    }),
    prisma.addressMaster.count({ where }),
  ]);

  return { items: rows.map(masterToItem), meta: buildMeta(params.page, params.pageSize, total) };
}

/** Approve / reject a pending (or any) Address Master locality. */
export async function reviewMaster(id: number, status: 'approved' | 'rejected', adminId: number) {
  return prisma.addressMaster.update({
    where: { id },
    data: { status, reviewedBy: adminId, reviewedAt: new Date() },
    select: { id: true, status: true },
  });
}

/** Admin-created master locality (created already approved). */
export async function createMaster(input: CreateMasterInput, adminId: number) {
  const city = await prisma.city.findUnique({ where: { id: input.cityId } });
  if (!city) throw ApiError.badRequest('Invalid cityId');
  const created = await prisma.addressMaster.create({
    data: {
      cityId: input.cityId,
      complex: input.complex?.trim() || undefined,
      lane1: input.lane1?.trim() || undefined,
      lane2: input.lane2?.trim() || undefined,
      area: input.area?.trim() || undefined,
      suburb: input.suburb?.trim() || undefined,
      pincode: input.pincode?.trim() || undefined,
      latitude: input.latitude,
      longitude: input.longitude,
      status: 'approved',
      source: 'admin',
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
    include: { city: { select: { name: true, state: true } } },
  });
  return masterToItem(created);
}

/** Edit a master locality's fields. */
export async function updateMaster(id: number, input: UpdateMasterInput) {
  if (input.cityId) {
    const city = await prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw ApiError.badRequest('Invalid cityId');
  }
  const updated = await prisma.addressMaster.update({
    where: { id },
    data: {
      cityId: input.cityId,
      complex: input.complex,
      lane1: input.lane1,
      lane2: input.lane2,
      area: input.area,
      suburb: input.suburb,
      pincode: input.pincode,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    include: { city: { select: { name: true, state: true } } },
  });
  return masterToItem(updated);
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
 * Bulk-import localities into the Address Master from a parsed spreadsheet. Each row maps
 * the source-sheet headers (Lane 1 / Lane 2 / Area / Suburb / City / Pincode) to an APPROVED
 * master locality. The building/complex-name column is intentionally ignored — the master
 * never stores buildings. Rows are deduped by (city, lane1, lane2, area).
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
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const complex = pick(r, ['complex name', 'complex', 'apartment', 'building']);
    const lane1 = pick(r, ['lane 1', 'lane1']);
    const lane2 = pick(r, ['lane 2', 'lane2', 'locality']);
    const area = pick(r, ['area']);
    const suburb = pick(r, ['suburb']);
    const cityName = pick(r, ['city']);
    const pincode = pick(r, ['pincode', 'pin code', 'zip']);

    // Need a city and at least one locality field to form a master entry.
    if (!cityName || (!lane1 && !lane2 && !area && !suburb)) {
      skipped++;
      continue;
    }

    try {
      let cityId = cityCache.get(cityName.toLowerCase());
      if (!cityId) {
        const existing = await prisma.city.findFirst({ where: { name: cityName } });
        cityId = existing?.id ?? (await prisma.city.create({ data: { name: cityName } })).id;
        cityCache.set(cityName.toLowerCase(), cityId);
        await ensureCityOtherDocType(cityId);
      }

      const dedupeKey = `${cityId}|${complex.toLowerCase()}|${lane1.toLowerCase()}|${lane2.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        skipped++;
        continue;
      }
      seen.add(dedupeKey);

      const existing = await prisma.addressMaster.findFirst({
        where: {
          cityId,
          complex: complex || null,
          lane1: lane1 || null,
          lane2: lane2 || null,
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.addressMaster.create({
        data: {
          cityId,
          complex: complex || undefined,
          lane1: lane1 || undefined,
          lane2: lane2 || undefined,
          area: area || undefined,
          suburb: suburb || undefined,
          pincode: pincode || undefined,
          status: 'approved',
          source: 'import',
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
