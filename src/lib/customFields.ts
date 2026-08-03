import { prisma } from './prisma.js';

export interface ResolvedArea {
  id: number;
  areaName: string;
  pincode: string | null;
  cityName: string | null;
}

export interface ResolvedCustomField {
  fieldId: number;
  subcategoryId: number;
  subcategoryName: string;
  category: string;
  fieldName: string;
  fieldType: string;
  fieldOptions: string | null;
  isRequired: boolean;
  sortOrder: number;
  value: string;
  resolvedAreas?: ResolvedArea[];
  dependsOnFieldId: number | null;
  dependsOnValue: string | null;
}

async function resolveAreas(fieldType: string, value: string): Promise<ResolvedArea[] | undefined> {
  if (fieldType !== 'pincode') return undefined;
  if (!value.trim()) return [];

  let ids: number[] = [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) ids = parsed.map(Number).filter(Number.isFinite);
  } catch {
    // malformed value — treat as no selection
  }
  if (!ids.length) return [];

  const areas = await prisma.area.findMany({
    where: { id: { in: ids } },
    include: { city: { select: { name: true } } },
  });
  const byId = new Map(areas.map((a) => [a.id, a]));
  return ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, areaName: a.areaName, pincode: a.pincode, cityName: a.city?.name ?? null }));
}

/**
 * Dynamic subcategory-field definitions + the SP's saved answers, for a given profile,
 * pre-resolved for display (pincode-type fields carry `resolvedAreas`).
 *
 * `onlyAnswered` drops fields with no saved value — used by resident-facing views so
 * blank labels never leak to visitors.
 */
export async function getCustomFieldsForProfile(
  profileId: number,
  opts: { onlyAnswered?: boolean } = {},
): Promise<ResolvedCustomField[]> {
  const serviceTypes = await prisma.profileServiceType.findMany({
    where: { profileId },
    select: { subcategoryId: true },
  });
  const subcategoryIds = Array.from(new Set(serviceTypes.map((s) => s.subcategoryId)));
  if (!subcategoryIds.length) return [];

  const fields = await prisma.serviceSubcategoryField.findMany({
    where: { subcategoryId: { in: subcategoryIds }, isActive: true },
    orderBy: [{ subcategoryId: 'asc' }, { sortOrder: 'asc' }],
    include: { subcategory: { select: { name: true } } },
  });
  const values = await prisma.spProfileCustomField.findMany({
    where: { profileId, fieldId: { in: fields.map((f) => f.id) } },
  });
  const valueByField = new Map(values.map((v) => [v.fieldId, v.fieldValue]));

  const out: ResolvedCustomField[] = [];
  for (const f of fields) {
    const value = valueByField.get(f.id) ?? '';
    if (opts.onlyAnswered && !value.trim()) continue;
    out.push({
      fieldId: f.id,
      subcategoryId: f.subcategoryId,
      subcategoryName: f.subcategory.name,
      category: f.category,
      fieldName: f.fieldName,
      fieldType: f.fieldType,
      fieldOptions: f.fieldOptions,
      isRequired: f.isRequired,
      sortOrder: f.sortOrder,
      value,
      resolvedAreas: await resolveAreas(f.fieldType, value),
      dependsOnFieldId: f.dependsOnFieldId,
      dependsOnValue: f.dependsOnValue,
    });
  }
  return out;
}
