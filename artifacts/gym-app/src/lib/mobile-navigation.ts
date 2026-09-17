export type NavigationLanguage = "en" | "fr" | "ar";

export const NAVIGATION_LANGUAGES: readonly NavigationLanguage[] = ["en", "fr", "ar"] as const;

export const NAVIGATION_LANGUAGE_OPTIONS: ReadonlyArray<{ value: NavigationLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ar", label: "العربية" },
] as const;

export const NAVIGATION_COPY: Record<NavigationLanguage, {
  openMenu: string;
  closeMenu: string;
  moreActions: string;
  memberOverview: string;
  periodReset: string;
  collapse: string;
  expand: string;
  lightMode: string;
  darkMode: string;
}> = {
  en: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    moreActions: "More actions",
    memberOverview: "Member Overview",
    periodReset: "New Period / Reset",
    collapse: "Collapse",
    expand: "Expand",
    lightMode: "Light mode",
    darkMode: "Dark mode",
  },
  fr: {
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
    moreActions: "Plus d’actions",
    memberOverview: "Aperçu des membres",
    periodReset: "Nouvelle période / Réinitialiser",
    collapse: "Réduire",
    expand: "Développer",
    lightMode: "Mode clair",
    darkMode: "Mode sombre",
  },
  ar: {
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    moreActions: "المزيد من الإجراءات",
    memberOverview: "نظرة عامة على الأعضاء",
    periodReset: "فترة جديدة / إعادة تعيين",
    collapse: "طي",
    expand: "توسيع",
    lightMode: "الوضع الفاتح",
    darkMode: "الوضع الداكن",
  },
};

export function directionForNavigationLanguage(language: NavigationLanguage): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}

export function nextNavigationLanguage(language: NavigationLanguage): NavigationLanguage {
  const index = NAVIGATION_LANGUAGES.indexOf(language);
  return NAVIGATION_LANGUAGES[(index + 1) % NAVIGATION_LANGUAGES.length];
}

export function navigationCopy(language: NavigationLanguage) {
  return NAVIGATION_COPY[language];
}
