import { prisma } from './prisma.js';

/**
 * Event dates and start times are stored as the host's wall-clock values (a "HH:mm" is
 * saved as that time on 1970-01-01 UTC), and every city served is in India.
 */
const EVENT_UTC_OFFSET_MINUTES = 330;

/** When an event starts, as a real instant; the start of its day when no time was set. */
export function eventStartsAt(date: Date, startTime: Date | null): Date {
  const wallClock = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    startTime?.getUTCHours() ?? 0,
    startTime?.getUTCMinutes() ?? 0,
  );
  return new Date(wallClock - EVENT_UTC_OFFSET_MINUTES * 60_000);
}

/** An event closes for joining (and withdrawing) once it starts. */
export function hasEventStarted(event: { date: Date; startTime: Date | null }): boolean {
  return eventStartsAt(event.date, event.startTime) <= new Date();
}

/**
 * When an event is over: its start plus its duration, or the end of its day (India time) when
 * it has no start time or no duration. Until then a started event is "ongoing" (BUG-101/102).
 */
export function eventEndsAt(date: Date, startTime: Date | null, durationMinutes?: number | null): Date {
  if (startTime && durationMinutes) {
    return new Date(eventStartsAt(date, startTime).getTime() + durationMinutes * 60_000);
  }
  const nextDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return new Date(eventStartsAt(nextDay, null).getTime() - 1);
}

export function hasEventEnded(event: { date: Date; startTime: Date | null; durationMinutes?: number | null }): boolean {
  return eventEndsAt(event.date, event.startTime, event.durationMinutes) <= new Date();
}

/** Today's date in India, as the UTC midnight an `@db.Date` column compares against. */
export function todayInIndia(): Date {
  const now = new Date(Date.now() + EVENT_UTC_OFFSET_MINUTES * 60_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The viewer's relationship to one event, as every event list reports it. */
export interface ViewerEventState {
  /** joined | pending_approval | null (not attending, or withdrawn). */
  myStatus: string | null;
  isHost: boolean;
  hasStarted: boolean;
  /** Over (see eventEndsAt): My Events lists it under Past, marked Closed. */
  hasEnded: boolean;
}

/**
 * Adds [ViewerEventState] to each event, so a list card can show Join / Joined / Pending /
 * Hosting / Closed without opening the event. One attendee query for the whole list.
 */
export async function withViewerEventState<
  T extends { id: number; creatorId: number; date: Date; startTime: Date | null; durationMinutes?: number | null },
>(events: T[], viewerId: number): Promise<(T & ViewerEventState)[]> {
  const rows = events.length
    ? await prisma.eventAttendee.findMany({
        where: { userId: viewerId, eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true, status: true },
      })
    : [];
  const statusByEvent = new Map(rows.map((r) => [r.eventId, r.status]));
  return events.map((e) => {
    const status = statusByEvent.get(e.id);
    return {
      ...e,
      myStatus: status === 'joined' || status === 'pending_approval' ? status : null,
      isHost: e.creatorId === viewerId,
      hasStarted: hasEventStarted(e),
      hasEnded: hasEventEnded(e),
    };
  });
}
