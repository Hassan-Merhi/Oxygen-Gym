// The gym operates on Lubumbashi time (UTC+2), but the server container clock
// runs in UTC. The gym's business day runs 21:00 -> 20:59:59.999 local time
// (the owner closes reports at 9pm and everything after that counts toward
// the next day), not a midnight-to-midnight calendar day. Any "today"
// boundary (caisse, subscriptions, sales, memberships, check-ins,
// accounting) must be computed with these helpers, or day totals will roll
// over at the wrong moment / inconsistently across pages.
const LUB_OFFSET_MS = 2 * 60 * 60 * 1000;
const BUSINESS_DAY_START_HOUR = 21;

/** Start (21:00 local) and end (20:59:59.999 local next day) of the current business day. */
export function lubumbashiBusinessDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const localMs = now.getTime() + LUB_OFFSET_MS;
  const localDateObj = new Date(localMs);
  const localHour = localDateObj.getUTCHours();
  const localDateStr = localDateObj.toISOString().slice(0, 10);

  let businessDateStr = localDateStr;
  if (localHour < BUSINESS_DAY_START_HOUR) {
    // Still before today's 21:00 cutoff, so we're within the business day
    // that started yesterday at 21:00.
    const d = new Date(`${localDateStr}T00:00:00+02:00`);
    d.setUTCDate(d.getUTCDate() - 1);
    businessDateStr = d.toISOString().slice(0, 10);
  }

  const start = new Date(`${businessDateStr}T${BUSINESS_DAY_START_HOUR}:00:00+02:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/** Start of the current business day (21:00 local), as a UTC instant. */
export function lubumbashiTodayStart(now: Date = new Date()): Date {
  return lubumbashiBusinessDayBounds(now).start;
}

/** End of the current business day (20:59:59.999 local next day), as a UTC instant. */
export function lubumbashiTodayEnd(now: Date = new Date()): Date {
  return lubumbashiBusinessDayBounds(now).end;
}
