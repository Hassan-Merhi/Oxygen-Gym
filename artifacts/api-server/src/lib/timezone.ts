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
    // that started yesterday at 21:00. Step back one day on the *local*
    // calendar date — the UTC date of a local midnight instant is already one
    // day behind, so stepping back on the UTC date would go back twice.
    const yesterday = new Date(
      Date.UTC(localDateObj.getUTCFullYear(), localDateObj.getUTCMonth(), localDateObj.getUTCDate() - 1),
    );
    businessDateStr = yesterday.toISOString().slice(0, 10);
  }

  const start = new Date(`${businessDateStr}T${BUSINESS_DAY_START_HOUR}:00:00+02:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/**
 * The scheduled 21:00 WhatsApp closeout belongs to the business day that JUST
 * ended. At 21:00 the normal "today" helpers have already moved to the next
 * business day, so using them directly would show zero for the closeout.
 *
 * Manual/on-demand previews can still use the ongoing business day.
 */
export function dailySummaryBusinessDay(
  now: Date = new Date(),
  lastCompleted = false,
): { start: Date; end: Date; dateKey: string } {
  const reportAt = lastCompleted
    ? new Date(lubumbashiBusinessDayBounds(now).start.getTime() - 1)
    : now;
  const { start, end } = lubumbashiBusinessDayBounds(reportAt);
  return { start, end, dateKey: businessDateKey(reportAt) };
}

/** Start of the current business day (21:00 local), as a UTC instant. */
export function lubumbashiTodayStart(now: Date = new Date()): Date {
  return lubumbashiBusinessDayBounds(now).start;
}

/** End of the current business day (20:59:59.999 local next day), as a UTC instant. */
export function lubumbashiTodayEnd(now: Date = new Date()): Date {
  return lubumbashiBusinessDayBounds(now).end;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Hours to add to a local Lubumbashi clock time so 21:00 lands on the next calendar day. */
const BUSINESS_SHIFT_MS = LUB_OFFSET_MS + (24 - BUSINESS_DAY_START_HOUR) * 60 * 60 * 1000;

/**
 * Business date (YYYY-MM-DD) that an instant belongs to. Everything recorded
 * from 21:00 local onwards counts toward the next date, matching the daily
 * cash close. Every report buckets days, months and years with this key so a
 * receipt never lands in different periods on different screens.
 */
export function businessDateKey(value: Date): string {
  return new Date(value.getTime() + BUSINESS_SHIFT_MS).toISOString().slice(0, 10);
}

/** First instant (21:00 local on the previous calendar day) of a business date. */
export function businessDayStart(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year!, month! - 1, day! - 1)).toISOString().slice(0, 10);
  return new Date(`${previous}T${BUSINESS_DAY_START_HOUR}:00:00+02:00`);
}

/** Last instant of a business date. */
export function businessDayEnd(dateKey: string): Date {
  return new Date(businessDayStart(dateKey).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Inclusive instant range covering business dates from..to (YYYY-MM-DD). */
export function businessDateRange(fromKey: string, toKey: string): { start: Date; end: Date } {
  return { start: businessDayStart(fromKey), end: businessDayEnd(toKey) };
}

/** Business month that contains `now`: the 1st's business day through the last day's. */
export function lubumbashiMonthBounds(now: Date = new Date()): { start: Date; end: Date } {
  const key = businessDateKey(now);
  const [year, month] = key.split("-").map(Number);
  const first = `${year}-${pad2(month!)}-01`;
  const last = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
  return businessDateRange(first, last);
}

/** Business year that contains `now`. */
export function lubumbashiYearBounds(now: Date = new Date()): { start: Date; end: Date } {
  const year = Number(businessDateKey(now).slice(0, 4));
  return businessDateRange(`${year}-01-01`, `${year}-12-31`);
}
