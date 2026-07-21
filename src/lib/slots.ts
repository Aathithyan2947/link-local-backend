import { prisma } from './prisma.js';

/**
 * Availability / bookable-slot helpers.
 *
 * An SP publishes a weekly template (SpAvailability). Bookable, date-specific slots are
 * generated on the fly from that template over a rolling horizon, minus blackout dates
 * (SpUnavailability) and minus slots already booked (SpScheduleSlot with isAvailable=false).
 * A materialized SpScheduleSlot row is created only when a resident actually books a slot.
 *
 * Times are wall-clock "HH:MM" (24h) strings on the template; @db.Time columns on
 * SpScheduleSlot are stored/read as UTC-anchored Dates (1970-01-01T<hh:mm>Z).
 */

export interface OpenSlot {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

const pad = (n: number) => String(n).padStart(2, '0');

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fromMinutes(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** "HH:MM" → Date for a @db.Time column (anchored to 1970-01-01 UTC). */
export function timeToDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}
/** @db.Time Date → "HH:MM" (UTC accessors, matching timeToDate). */
export function dateToHHMM(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "YYYY-MM-DD" → Date for a @db.Date column (UTC midnight). */
export function dateOnly(y: string): Date {
  return new Date(`${y}T00:00:00.000Z`);
}
/** Date → "YYYY-MM-DD" (UTC accessors). */
export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

type Template = { workingDays: number[]; startTime: string; endTime: string; slotMinutes: number | null };

/** Expand a weekly template into candidate slots across [fromYmd, fromYmd+days). */
export function expandTemplate(tpl: Template, fromYmd: string, days: number): OpenSlot[] {
  const slots: OpenSlot[] = [];
  const startMin = toMinutes(tpl.startTime);
  const endMin = toMinutes(tpl.endTime);
  if (!(endMin > startMin)) return slots;
  const step = tpl.slotMinutes && tpl.slotMinutes > 0 ? tpl.slotMinutes : endMin - startMin;
  const base = dateOnly(fromYmd).getTime();
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * 86_400_000);
    if (!tpl.workingDays.includes(d.getUTCDay())) continue;
    const date = ymd(d);
    for (let s = startMin; s + step <= endMin; s += step) {
      slots.push({ date, startTime: fromMinutes(s), endTime: fromMinutes(s + step) });
    }
  }
  return slots;
}

/**
 * Open bookable slots for an SP over a horizon, with blackout dates and already-booked
 * slots removed. Returns [] if the SP hasn't published availability.
 */
export async function computeOpenSlots(profileId: number, fromYmd?: string, days?: number): Promise<OpenSlot[]> {
  const tpl = await prisma.spAvailability.findUnique({ where: { profileId } });
  if (!tpl) return [];

  const from = fromYmd ?? ymd(new Date());
  const horizon = Math.max(1, days ?? tpl.horizonDays);
  const candidates = expandTemplate(tpl, from, horizon);
  if (candidates.length === 0) return [];

  const fromDate = dateOnly(from);
  const toDate = new Date(fromDate.getTime() + horizon * 86_400_000);
  const [blackouts, booked] = await Promise.all([
    prisma.spUnavailability.findMany({ where: { profileId, unavailableDate: { gte: fromDate, lt: toDate } } }),
    prisma.spScheduleSlot.findMany({
      where: { profileId, isAvailable: false, slotDate: { gte: fromDate, lt: toDate } },
    }),
  ]);
  const blackoutDates = new Set(blackouts.map((b) => ymd(b.unavailableDate)));
  const bookedKeys = new Set(booked.map((b) => `${ymd(b.slotDate)}T${dateToHHMM(b.startTime)}`));

  return candidates.filter(
    (c) => !blackoutDates.has(c.date) && !bookedKeys.has(`${c.date}T${c.startTime}`),
  );
}

/** True if a specific slot is still open for booking. */
export async function isSlotOpen(profileId: number, slot: OpenSlot): Promise<boolean> {
  const open = await computeOpenSlots(profileId, slot.date, 1);
  return open.some((s) => s.startTime === slot.startTime && s.endTime === slot.endTime);
}
