import { prisma } from './prisma.js';

export type ProviderKind = 'product' | 'service';

/** Platform fee applied to product orders (flat, in ₹). */
export const PLATFORM_FEE = 20;

/**
 * Resolves which features a service provider has enabled, from the onboarding fields their
 * selected subcategories configure:
 *
 *  - a field of type `menu` → SP can add menu items; residents see the cart flow
 *  - a field of type `booking` → SP can publish availability slots; residents book them
 *
 * Configured under the `service_type` category, so a subcategory's whole onboarding — Basic
 * Details, Travel, Service Type — is set up in one place.
 *
 * `ServiceSubcategory.type` used to be a second, parallel signal and is no longer read; the
 * 20260813120000 migration turned every remaining flag into a field. The column is kept for
 * now so the change is reversible.
 */
export async function resolveProviderFeatures(profileId: number): Promise<{ hasMenu: boolean; hasDateBooking: boolean }> {
  const types = await prisma.profileServiceType.findMany({
    where: { profileId },
    select: {
      subcategory: {
        select: { fields: { where: { isActive: true }, select: { fieldType: true } } },
      },
    },
  });

  let hasMenu = false;
  let hasDateBooking = false;

  for (const { subcategory } of types) {
    for (const field of subcategory.fields) {
      if (field.fieldType === 'menu') hasMenu = true;
      if (field.fieldType === 'booking') hasDateBooking = true;
    }
  }

  return { hasMenu, hasDateBooking };
}

/** Backward-compat shim — callers that only need the binary string. */
export async function resolveProviderKind(profileId: number): Promise<ProviderKind> {
  const { hasMenu } = await resolveProviderFeatures(profileId);
  return hasMenu ? 'product' : 'service';
}
