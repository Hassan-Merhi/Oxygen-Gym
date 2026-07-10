// The gym operates on Lubumbashi time (UTC+2), but the server container clock
// runs in UTC. Any "today" boundary must be computed against Lubumbashi's
// local day, not the server's raw UTC day, or day-based totals (caisse,
// check-ins, accounting) will roll over at the wrong moment / inconsistently
// across pages.
const LUB_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Local Lubumbashi calendar date (YYYY-MM-DD) for "now". */
export function lubumbashiDateStr(now: Date = new Date()): string {
  return new Date(now.getTime() + LUB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of the current Lubumbashi day, as a UTC instant. */
export function lubumbashiTodayStart(now: Date = new Date()): Date {
  return new Date(`${lubumbashiDateStr(now)}T00:00:00+02:00`);
}

/** End of the current Lubumbashi day, as a UTC instant. */
export function lubumbashiTodayEnd(now: Date = new Date()): Date {
  return new Date(`${lubumbashiDateStr(now)}T23:59:59.999+02:00`);
}
