import { z } from 'zod';

/**
 * Validation for locality text — building/complex names, lanes, areas, suburbs — shared by
 * the admin Address Master and the app's address form, which also feeds that master.
 *
 * Letters in any script (with their combining marks, so Devanagari vowel signs pass),
 * digits, spaces and . , ' & ( ) / - # — enough for "Sudarshan Sky Garden, Tower #2" or
 * "12/B", not for "@#$%^". Surrounding spaces are trimmed and runs of spaces collapsed.
 */
const ALLOWED = /^[\p{L}\p{M}\p{N} .,'&()/#-]+$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export const LOCALITY_LIMITS = { complex: 80, text: 100 } as const;

const normalize = (v: string) => v.trim().replace(/\s+/g, ' ');

export function localityText(label: string, max: number) {
  return z
    .string()
    .transform(normalize)
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .min(2, `${label} must be at least 2 characters`)
        .max(max, `${label} must be at most ${max} characters`)
        .regex(ALLOWED, `${label}: only letters, numbers, spaces and . , ' & ( ) / - # are allowed`)
        .regex(HAS_LETTER_OR_DIGIT, `${label} must include a letter or number`),
    );
}

/** An Indian PIN code: six digits, not starting with 0. */
export function pincode(label = 'Pincode') {
  return z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^[1-9]\d{5}$/, `${label} must be 6 digits and can't start with 0`));
}
