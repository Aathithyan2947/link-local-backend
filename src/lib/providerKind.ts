import { prisma } from './prisma.js';

/**
 * A Service Provider is either a **product** SP (bakery/food — sells menu items, cart flow)
 * or a **service** SP (tutor/coach — publishes charges, takes session bookings). The kind is
 * driven by the top-level ServiceCategory of the SP's primary service type
 * (`ServiceCategory.kind`), defaulting to 'service' when the SP hasn't picked a category yet.
 */
export type ProviderKind = 'product' | 'service';

/** Platform fee applied to product orders (flat, in ₹). Mock economics — tune freely. */
export const PLATFORM_FEE = 20;

/** Resolve the provider kind for a profile from its service categories. */
export async function resolveProviderKind(profileId: number): Promise<ProviderKind> {
  const types = await prisma.profileServiceType.findMany({
    where: { profileId },
    select: { subcategory: { select: { category: { select: { kind: true } } } } },
  });
  // A single 'product' category (e.g. Food) makes the SP a product seller.
  for (const t of types) {
    if (t.subcategory.category.kind === 'product') return 'product';
  }
  return 'service';
}
