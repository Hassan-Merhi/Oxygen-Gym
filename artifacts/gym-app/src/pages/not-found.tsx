import { Link } from "wouter";
import { ArrowLeft, SearchX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold tabular-nums text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.description")}</p>
        <Link href="/" className={cn(buttonVariants(), "mt-6 w-full sm:w-auto")}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {t("notFound.back")}
        </Link>
      </div>
    </main>
  );
}
