import { useI18n } from "@/lib/i18n";

/**
 * Text direction for the active language. Radix primitives default to "ltr"
 * and write it to the DOM, so wrappers pass this explicitly.
 */
export function useDir(): "ltr" | "rtl" {
  const { language } = useI18n();
  return language === "ar" ? "rtl" : "ltr";
}
