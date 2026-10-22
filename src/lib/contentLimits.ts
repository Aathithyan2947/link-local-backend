import { z } from 'zod';

/**
 * Limits for member-created content (posts, groups, events). The app enforces the same numbers
 * with the same messages (content_limits.dart) and shows them under each field, so a value the
 * app accepts is never rejected here (BUG-070–074).
 */
export const CONTENT_LIMITS = {
  postText: 2000,
  titleMin: 3,
  titleMax: 80,
  description: 2000,
  /** Same cap as provider charges (PROFILE_LIMITS.rateAmount); price columns are DECIMAL(10,2). */
  price: 1_000_000,
  maxMembersMin: 2,
  maxMembersMax: 10_000,
  maxAttendeesMin: 1,
  maxAttendeesMax: 10_000,
  durationMin: 15,
  durationMax: 1440,
  location: 200,
  onlineLink: 500,
  materialItem: 100,
  materialItems: 20,
} as const;

const L = CONTENT_LIMITS;

// Letters (any language), digits, spaces and a little punctuation — no emoji, symbols or #
// (the user's call, 2026-10-22). Same set as the app's ContentLimits.titleInputFormatter.
const TITLE_CHARS = /^[\p{L}\p{M}\p{N} .,'&()/\-!?:+]+$/u;

/** A group name or event title: 3–80 characters, must include a letter. */
export const titleField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .min(L.titleMin, `${label} must be at least ${L.titleMin} characters`)
    .max(L.titleMax, `${label} can be at most ${L.titleMax} characters`)
    .regex(TITLE_CHARS, `${label}: only letters, numbers, spaces and . , ' & ( ) / - ! ? : + are allowed`)
    .regex(/\p{L}/u, `${label} must include a letter`);

export const descriptionField = z
  .string()
  .trim()
  .max(L.description, `Description can be at most ${L.description} characters`);

export const postTextField = z
  .string()
  .trim()
  .max(L.postText, `Post can be at most ${L.postText} characters`);

/** A paid group/event's price: more than 0, at most ₹10,00,000, at most 2 decimals. */
export const priceField = z.coerce
  .number()
  .positive('Price must be greater than 0')
  .max(L.price, 'Price can be at most ₹10,00,000')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Price can have at most 2 decimals');

/** "isPaid" needs a price — as a zod issue on `price`, so the app shows it under that field. */
export function requirePriceWhenPaid(
  data: { isPaid?: boolean; price?: number },
  ctx: z.RefinementCtx,
  what: 'group' | 'event',
) {
  if (data.isPaid === true && data.price == null) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: `Enter a price for a paid ${what}` });
  }
}

/** A field error in the same `{ field: [message] }` shape zod validation errors use. */
export const fieldError = (field: string, message: string) => ({ [field]: [message] });
