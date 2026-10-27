import { z } from 'zod';

/** The most areas one list can be narrowed to at once. */
export const MAX_AREA_IDS = 20;

/**
 * `?areaIds=3,7,9`: several areas picked in one of Home's section dropdowns (BUG-086).
 * Deduplicated; at most [MAX_AREA_IDS].
 */
export const areaIdsQuery = z
  .string()
  .regex(/^\d+(,\d+)*$/, 'areaIds must be comma-separated area ids')
  .transform((s) => [...new Set(s.split(',').map(Number))])
  .pipe(z.array(z.number().int().positive()).max(MAX_AREA_IDS, `Pick at most ${MAX_AREA_IDS} areas`));
