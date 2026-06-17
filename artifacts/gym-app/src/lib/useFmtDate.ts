import { useI18n } from "@/lib/i18n";
import {
  fmtDate as _fmtDate,
  fmtDateTime as _fmtDateTime,
  fmtTime as _fmtTime,
  langToLocale,
} from "@/lib/date";

export function useFmtDate() {
  const { language } = useI18n();
  const locale = langToLocale(language);
  return {
    fmtDate: (d: string | Date | null | undefined) => _fmtDate(d, locale),
    fmtDateTime: (d: string | Date | null | undefined) => _fmtDateTime(d, locale),
    fmtTime: (d: string | Date | null | undefined) => _fmtTime(d, locale),
    locale,
  };
}
