import { prisma } from './prisma.js';
import { resolveProviderFeatures } from './providerKind.js';
import { getCustomFieldsForProfile, type ResolvedCustomField } from './customFields.js';
import { hasSubmittedAddressProof } from './addressProof.js';

/**
 * "Complete your profile" (the Profile tab's meter): one checklist of things a member can
 * actually fill in from the app, each worth the same. Residents have 6 steps, providers 9.
 *
 * It replaced a score that counted three things no screen saves any more (payment-method
 * rows, delivery-preference rows, the old contacts list), so nobody could reach 100%, and
 * that was only recomputed on some saves, so most profiles showed 0%. This one is computed
 * from the live data whenever it's read.
 */
export type CompletionKey =
  | 'photo'
  | 'address'
  | 'addressProof'
  | 'about'
  | 'education'
  | 'profession'
  | 'services'
  | 'businessDetails'
  | 'menuItems'
  | 'charges';

export interface CompletionItem {
  key: CompletionKey;
  label: string;
  done: boolean;
}

export interface ProfileCompletion {
  percent: number;
  items: CompletionItem[];
}

/** The provider onboarding steps, as the app chains them (category_fields_form_screen.dart). */
const ONBOARDING_CATEGORIES = new Set(['basic_details', 'travel', 'payment', 'service_type', 'delivery']);

/** A `menu` / `booking` field marks a feature set up elsewhere; it's never "unanswered". */
const isFeatureMarker = (f: ResolvedCustomField) => f.fieldType === 'menu' || f.fieldType === 'booking';

/**
 * Whether a required onboarding question is still blank. Payment questions are left out, as
 * on Home's "Complete your profile" banner (they count under Charges instead), and a question
 * that only shows for another answer counts only when that answer is picked, as in the form.
 */
function hasUnansweredRequired(fields: ResolvedCustomField[]): boolean {
  const byId = new Map(fields.map((f) => [f.fieldId, f]));
  return fields.some((f) => {
    if (!f.isRequired || isFeatureMarker(f)) return false;
    if (!ONBOARDING_CATEGORIES.has(f.category) || f.category === 'payment') return false;
    if (f.dependsOnFieldId != null && byId.get(f.dependsOnFieldId)?.value !== f.dependsOnValue) return false;
    return !f.value.trim();
  });
}

/** The checklist for [profileId], read-only; null when there's no such profile. */
export async function computeCompletion(profileId: number): Promise<ProfileCompletion | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      userId: true,
      photoUrl: true,
      addressId: true,
      aboutMe: true,
      onboardingCompletedAt: true,
      user: { select: { userType: true } },
      _count: {
        select: {
          educations: true,
          professions: true,
          serviceTypes: true,
          products: true,
          rates: { where: { isActive: true } },
        },
      },
    },
  });
  if (!profile) return null;

  const isProvider = profile.user.userType === 'service_provider';
  const [proofSubmitted, features, fields] = await Promise.all([
    hasSubmittedAddressProof(profile.userId),
    isProvider ? resolveProviderFeatures(profileId) : null,
    isProvider ? getCustomFieldsForProfile(profileId) : Promise.resolve([] as ResolvedCustomField[]),
  ]);

  // A provider may have answered About / Education / Profession as Basic Details questions
  // instead; their profile shows those answers, so they count (as basic_details_fields.dart).
  const basicAnswer = (pattern: RegExp) =>
    fields.some((f) => f.category === 'basic_details' && pattern.test(f.fieldName) && !!f.value.trim());

  const items: CompletionItem[] = [
    { key: 'photo', label: 'Profile photo', done: !!profile.photoUrl },
    { key: 'address', label: 'Address', done: profile.addressId != null },
    // Under review counts, as it does for the action gate (BUG-084).
    { key: 'addressProof', label: 'Address proof', done: proofSubmitted },
    { key: 'about', label: 'About you', done: !!profile.aboutMe?.trim() || basicAnswer(/about/i) },
    { key: 'education', label: 'Education', done: profile._count.educations > 0 || basicAnswer(/^education/i) },
    { key: 'profession', label: 'Profession', done: profile._count.professions > 0 || basicAnswer(/^profession/i) },
  ];
  if (isProvider) {
    items.push(
      { key: 'services', label: 'Services', done: profile._count.serviceTypes > 0 },
      {
        key: 'businessDetails',
        label: 'Business details',
        // Finished the onboarding questions (recorded when they confirm the last step), with
        // nothing required left blank since (an admin can add a question later).
        done: profile.onboardingCompletedAt != null && !hasUnansweredRequired(fields),
      },
      features?.hasMenu
        ? { key: 'menuItems', label: 'Menu items', done: profile._count.products > 0 }
        : {
            key: 'charges',
            label: 'Charges',
            done:
              profile._count.rates > 0 ||
              fields.some((f) => f.category === 'payment' && !isFeatureMarker(f) && !!f.value.trim()),
          },
    );
  }

  const done = items.filter((i) => i.done).length;
  return { percent: Math.round((done / items.length) * 100), items };
}
