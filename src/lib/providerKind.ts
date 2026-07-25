import { prisma } from './prisma.js';

export type ProviderKind = 'product' | 'service';

/** Platform fee applied to product orders (flat, in ₹). */
export const PLATFORM_FEE = 20;

/**
 * Resolves which features a service provider has enabled, based on their
 * selected subcategories. Two signals are combined:
 *
 *  1. `ServiceSubcategory.type` — explicit flag set in the subcategory edit modal
 *  2. `ServiceSubcategoryField.fieldType` — onboarding fields with type 'menu' or 'date'
 *
 *  - `menu`  → SP can add menu items; residents see cart flow
 *  - `date`  → SP can publish availability slots; residents see slot picker + booking
 */
export async function resolveProviderFeatures(profileId: number): Promise<{ hasMenu: boolean; hasDateBooking: boolean }> {
  const types = await prisma.profileServiceType.findMany({
    where: { profileId },
    select: {
      subcategory: {
        select: {
          type: true,
          fields: { where: { isActive: true }, select: { fieldType: true } },
        },
      },
    },
  });

  let hasMenu = false;
  let hasDateBooking = false;

  for (const { subcategory } of types) {
    // Signal 1: explicit subcategory.type column
    if (subcategory.type === 'menu') hasMenu = true;
    if (subcategory.type === 'date') hasDateBooking = true;

    // Signal 2: onboarding field with fieldType 'menu' or 'date'
    for (const field of subcategory.fields) {
      if (field.fieldType === 'menu') hasMenu = true;
      if (field.fieldType === 'date') hasDateBooking = true;
    }
  }

  return { hasMenu, hasDateBooking };
}

/** Backward-compat shim — callers that only need the binary string. */
export async function resolveProviderKind(profileId: number): Promise<ProviderKind> {
  const { hasMenu } = await resolveProviderFeatures(profileId);
  return hasMenu ? 'product' : 'service';
}
