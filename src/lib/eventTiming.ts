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

/** The viewer's relationship to one event, as every event list reports it. */
export interface ViewerEventState {
  /** joined | pending_approval | null (not attending, or withdrawn). */
  myStatus: string | null;
  isHost: boolean;
  hasStarted: boolean;
}

/**
 * Adds [ViewerEventState] to each event, so a list card can show Join / Joined / Pending /
 * Hosting / Closed without opening the event. One attendee query for the whole list.
 */
export async function withViewerEventState<
  T extends { id: number; creatorId: number; date: Date; startTime: Date | null },
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
    };
  });
}
