// Pure "YYYY-MM-DD" date-key helpers shared by timetable/lessons/attendance.
// No Convex imports — usable from any runtime (and trivially unit-testable).

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `s` is a well-formed "YYYY-MM-DD" key naming a real calendar
 * date. The component round-trip catches rollovers ("2026-02-30" parses to
 * March 2) and invalid months (Invalid Date → NaN components).
 */
export function isValidDateKey(s: string): boolean {
  if (!DATE_KEY_RE.test(s)) return false;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  const parsed = new Date(s + "T00:00:00");
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

/** Weekday of a date key: 0=Sunday … 6=Saturday. */
export function weekdayOf(dateKey: string): number {
  return new Date(dateKey + "T00:00:00").getDay();
}
