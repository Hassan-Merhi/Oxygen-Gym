const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

export function langToLocale(lang: string): string {
  const map: Record<string, string> = { en: "en-GB", fr: "fr-FR", ar: "ar-DZ" };
  return map[lang] ?? "en-GB";
}

export function fmtDate(d: string | Date | null | undefined, locale = "en-GB"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, DATE_OPTS);
}

export function fmtDateTime(d: string | Date | null | undefined, locale = "en-GB"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, { ...DATE_OPTS, hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(d: string | Date | null | undefined, locale = "en-GB"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Inline helper for template strings where importing fmtDate isn't available */
export function fmtDateStr(d: string | Date | null | undefined): string {
  return fmtDate(d);
}
