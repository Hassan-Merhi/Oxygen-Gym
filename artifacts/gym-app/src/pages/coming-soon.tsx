import { useI18n } from "@/lib/i18n";

export default function ComingSoon() {
  const { t } = useI18n();
  
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
        <span className="text-2xl font-bold text-muted-foreground">?</span>
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">{t("nav.comingSoon")}</h1>
      <p className="text-muted-foreground max-w-md">{t("common.comingSoonMsg")}</p>
    </div>
  );
}