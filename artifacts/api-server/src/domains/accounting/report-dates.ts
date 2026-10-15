import { businessDayEnd, businessDayStart } from "../../lib/timezone";
import { optionalDate } from "../../shared/http/validation";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a report range: a YYYY-MM-DD business date or an ISO instant. */
export function rangeStart(value: unknown, field = "dateFrom"): Date | undefined {
  if (typeof value === "string" && DATE_KEY.test(value)) return businessDayStart(value);
  return optionalDate(value, field);
}

/** End of a report range (inclusive): a YYYY-MM-DD business date or an ISO instant. */
export function rangeEnd(value: unknown, field = "dateTo"): Date | undefined {
  if (typeof value === "string" && DATE_KEY.test(value)) return businessDayEnd(value);
  return optionalDate(value, field);
}
