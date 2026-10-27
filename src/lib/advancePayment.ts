import { getCustomFieldsForProfile } from './customFields.js';

/**
 * A provider's advance-payment terms (BUG-097), from their answers to admin-configured
 * questions. The questions have no stable key, so they're matched by name, and providers have
 * them in three shapes (read from production, 2026-10-27):
 *   - Food: Delivery "Advanced Payment Settings" [No Advance | Percentage Based], then a number
 *     "Advance percentage";
 *   - Fashion: Delivery "How much advance do you need?" (same options), then "Advance percentage";
 *   - Beauticians: Basic Details "Advance payment" [10% / 25% / 50% / 100% advance].
 * `percent` 0 means no advance (the buyer pays later); 100 means everything at checkout.
 */
export interface AdvanceTerms {
  percent: number;
}

const MODE_NAMES = new Set([
  'advanced payment settings',
  'advance payment settings',
  'how much advance do you need?',
  'how much advance do you need',
  'advance payment',
]);
const PERCENT_NAMES = new Set(['advance percentage', 'advance percent', 'advance %']);

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Whether a question is the advance percentage, which only takes 1–100. */
export const isAdvancePercentField = (fieldName: string) => PERCENT_NAMES.has(norm(fieldName));

/** The percentage in an answer like "50", "50%" or "50% advance": 1–100, else null. */
export function parseAdvancePercent(value: string | null | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(value ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : null;
}

/** What's wrong with an advance percentage answer, or null. Blank is fine (not answered). */
export function advancePercentError(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  return /^\d+(\.\d+)?\s*%?$/.test(t) && parseAdvancePercent(t) != null
    ? null
    : 'Advance percentage must be between 1 and 100';
}

/**
 * The terms in a provider's answered questions; null when they set none, or set one that
 * can't be read (e.g. "500"), which means paying in full at checkout as before. The mode
 * question wins over a leftover percentage answer: "No Advance" with an old "50" is no advance.
 */
export function advanceTermsFromFields(fields: { fieldName: string; value?: string | null }[]): AdvanceTerms | null {
  const answer = (names: Set<string>) =>
    fields.find((f) => names.has(norm(f.fieldName)) && (f.value ?? '').trim())?.value?.trim() ?? null;
  const mode = answer(MODE_NAMES);
  const percentAnswer = answer(PERCENT_NAMES);
  if (mode) {
    const m = mode.toLowerCase();
    if (m.includes('no advance')) return { percent: 0 };
    const p = parseAdvancePercent(m.includes('percentage') ? percentAnswer : mode);
    return p == null ? null : { percent: p };
  }
  const p = parseAdvancePercent(percentAnswer);
  return p == null ? null : { percent: p };
}

export async function resolveAdvanceTerms(spProfileId: number): Promise<AdvanceTerms | null> {
  return advanceTermsFromFields(await getCustomFieldsForProfile(spProfileId, { onlyAnswered: true }));
}

/** What checkout charges for [total] at [percent]: whole rupees, never more than the total. */
export function advanceAmount(total: number, percent: number): number {
  if (percent >= 100) return total;
  if (percent <= 0) return 0;
  return Math.min(total, Math.round((total * percent) / 100));
}
