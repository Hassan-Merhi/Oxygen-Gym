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

/** Start of a Lubumbashi calendar date, as a UTC instant. */
function localDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+02:00`);
}

/**
 * Start (00:00 local on the 1st) and end (23:59:59.999 local on the last day)
 * of the current Lubumbashi calendar month, as UTC instants.
 */
export function lubumbashiMonthBounds(now: Date = new Date()): { start: Date; end: Date } {
  const local = new Date(now.getTime() + LUB_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth(); // 0-based

  const start = localDateStart(`${year}-${pad2(month + 1)}-01`);
  const nextMonthDate = new Date(Date.UTC(year, month + 1, 1));
  const end = new Date(localDateStart(nextMonthDate.toISOString().slice(0, 10)).getTime() - 1);

  return { start, end };
}

/**
 * Start (00:00 local on Jan 1st) and end (23:59:59.999 local on Dec 31st) of the
 * current Lubumbashi calendar year, as UTC instants.
 */
export function lubumbashiYearBounds(now: Date = new Date()): { start: Date; end: Date } {
  const year = new Date(now.getTime() + LUB_OFFSET_MS).getUTCFullYear();

  const start = localDateStart(`${year}-01-01`);
  const end = new Date(localDateStart(`${year + 1}-01-01`).getTime() - 1);

  return { start, end };
}
