import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n-format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Compact previous / next pager with a translated "Page x of y" label. */
export function Pager({
  page,
  totalPages,
  onPageChange,
  summary,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  if (totalPages <= 1 && !summary) return null;
  return (
    <nav aria-label={t("common.pagination")} className={cn("flex flex-wrap items-center justify-between gap-3 px-1", className)}>
      <span className="text-sm text-muted-foreground">{summary}</span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label={t("common.previous")}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
          <span className="min-w-[6rem] text-center text-sm text-muted-foreground" aria-live="polite">
            {fmt(t("common.pageOf"), { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            aria-label={t("common.next")}
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}

/** Shared empty state used by list pages. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}
