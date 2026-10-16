import { useMemo, useState } from "react";
import { useListSales } from "@workspace/api-client-react";
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Eye, Pencil, Printer, ReceiptText, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt as format } from "@/lib/i18n-format";
import { cn } from "@/lib/utils";
import { fmtMoney, localDateInput, saleDayKey, type HistoryPeriod } from "./sales-utils";

const PAGE_SIZE = 100;

interface SaleHistoryProps {
  t: (k: string) => string;
  locale: string;
  canEdit: boolean;
  canVoid: boolean;
  printingSaleId: number | null;
  onView: (id: number) => void;
  onPrint: (id: number) => void;
  onEdit: (id: number) => void;
  onVoid: (sale: Record<string, unknown>) => void;
}

export function SaleHistory({ t, locale, canEdit, canVoid, printingSaleId, onView, onPrint, onEdit, onVoid }: SaleHistoryProps) {
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyCurrency, setHistoryCurrency] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("all");

  const { data: historyData, isLoading } = useListSales({
    page: String(historyPage),
    limit: String(PAGE_SIZE),
    search: historySearch || undefined,
    status: historyStatus || undefined,
    currency: historyCurrency || undefined,
    dateFrom: historyDateFrom || undefined,
    dateTo: historyDateTo || undefined,
  });

  const historyItems = historyData as unknown as {
    items: Record<string, unknown>[];
    total: number;
    page: number;
    limit: number;
  } | undefined;
  const totalHistoryPages = historyItems ? Math.max(1, Math.ceil(historyItems.total / PAGE_SIZE)) : 1;
  const hasHistoryFilters = Boolean(historySearch || historyStatus || historyCurrency || historyDateFrom || historyDateTo);

  const groupedByDay = useMemo(() => {
    const items = historyItems?.items ?? [];
    const byDay: Record<string, { usd: typeof items; cdf: typeof items }> = {};
    for (const sale of items) {
      const day = saleDayKey(sale.saleDate);
      if (!byDay[day]) byDay[day] = { usd: [], cdf: [] };
      if ((sale.currency as string) === "USD") byDay[day].usd.push(sale);
      else byDay[day].cdf.push(sale);
    }
    return Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a));
  }, [historyItems]);

  const applyHistoryPeriod = (period: HistoryPeriod) => {
    setHistoryPeriod(period);
    setHistoryPage(1);

    if (period === "all") {
      setHistoryDateFrom("");
      setHistoryDateTo("");
      return;
    }
    if (period === "custom") return;

    const today = new Date();
    let from = new Date(today);
    let to = new Date(today);

    if (period === "yesterday") {
      from.setDate(from.getDate() - 1);
      to = new Date(from);
    } else if (period === "monthly") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (period === "yearly") {
      from = new Date(today.getFullYear(), 0, 1);
    }

    setHistoryDateFrom(localDateInput(from));
    setHistoryDateTo(localDateInput(to));
  };

  const clearHistoryFilters = () => {
    setHistorySearch("");
    setHistoryStatus("");
    setHistoryCurrency("");
    setHistoryDateFrom("");
    setHistoryDateTo("");
    setHistoryPeriod("all");
    setHistoryPage(1);
  };

  const salesCount = (count: number) => format(t(count === 1 ? "sales.countOne" : "sales.countMany"), { count });

  const periods: Array<[HistoryPeriod, string]> = [
    ["today", t("sales.period.today")],
    ["yesterday", t("sales.period.yesterday")],
    ["all", t("sales.period.all")],
    ["monthly", t("sales.period.month")],
    ["yearly", t("sales.period.year")],
  ];

  const renderSaleRow = (sale: Record<string, unknown>) => {
    const currency = sale.currency as string;
    const sym = currency === "USD" ? "$" : "FC";
    const formatSaleMoney = (value: number) => fmtMoney(Number(value), sym);
    const saleNumber = (sale.saleNumber as string) || `#${sale.id as number}`;
    const time = sale.saleDate
      ? new Date(sale.saleDate as string).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : "";
    const voided = sale.status === "voided";

    return (
      <li
        key={sale.id as number}
        className={cn(
          // Phone: two-column receipt card. md+: one aligned row.
          "grid grid-cols-2 items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30",
          "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] md:gap-3",
          voided && "opacity-60",
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{saleNumber}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{time || (sale.createdBy as string) || "—"}</p>
        </div>

        <div className="text-end md:text-start">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("sales.history.total")}</p>
          <p className="font-semibold tabular-nums">{formatSaleMoney(sale.totalAmount as number)}</p>
        </div>

        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("sales.history.paidChange")}</p>
          <p className="text-sm tabular-nums">{formatSaleMoney(sale.paymentAmount as number)}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{t("sales.history.change")} {formatSaleMoney(sale.changeDue as number)}</p>
        </div>

        <div className="text-end md:text-start">
          <span className="sr-only">{t("sales.history.status")}: </span>
          <Badge variant={voided ? "destructive" : "default"} className="text-xs">
            {t(`sales.status.${sale.status as string}`)}
          </Badge>
        </div>

        <div className="col-span-2 flex justify-end gap-1 border-t border-border/50 pt-2 md:col-span-1 md:border-0 md:pt-0">
          <Button variant="ghost" size="icon" onClick={() => onView(sale.id as number)} aria-label={format(t("sales.aria.view"), { number: saleNumber })} title={t("sales.viewSale")}>
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPrint(sale.id as number)}
            disabled={printingSaleId === sale.id}
            aria-label={format(t("sales.aria.print"), { number: saleNumber })}
            title={t("sales.printReceipt")}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
          </Button>
          {canEdit && !voided && (
            <Button variant="ghost" size="icon" onClick={() => onEdit(sale.id as number)} aria-label={format(t("sales.aria.edit"), { number: saleNumber })} title={t("common.edit")}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {canVoid && !voided && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onVoid(sale)}
              aria-label={format(t("sales.aria.void"), { number: saleNumber })}
              title={t("sales.void")}
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">{t("sales.history")}</h2>
            <p className="text-xs text-muted-foreground">{t("sales.historyHint")}</p>
          </div>

          <div className="relative w-full lg:w-80">
            <Label htmlFor="sales-history-search" className="sr-only">{t("sales.historySearchLabel")}</Label>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="sales-history-search"
              type="search"
              className="ps-9"
              placeholder={`${t("sales.history.number")} / ${t("sales.history.by")}`}
              value={historySearch}
              onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full flex-wrap gap-1 rounded-xl bg-muted/50 p-1 sm:w-auto" role="group" aria-label={t("sales.periodLabel")}>
              {periods.map(([period, label]) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => applyHistoryPeriod(period)}
                  aria-pressed={historyPeriod === period}
                  className={cn(
                    "min-h-11 flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none md:min-h-9",
                    historyPeriod === period
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex overflow-hidden rounded-xl border border-border/60 bg-background" role="group" aria-label={t("sales.currency")}>
              {(["", "USD", "CDF"] as const).map((currency) => (
                <button
                  key={currency || "all-currency"}
                  type="button"
                  aria-pressed={historyCurrency === currency}
                  className={cn(
                    "min-h-11 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-9",
                    historyCurrency === currency
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => { setHistoryCurrency(currency); setHistoryPage(1); }}
                >
                  {currency === "" ? t("sales.allCurrencies") : currency}
                </button>
              ))}
            </div>

            <Select value={historyStatus || "all"} onValueChange={(value) => { setHistoryStatus(value === "all" ? "" : value); setHistoryPage(1); }}>
              <SelectTrigger className="w-full rounded-xl sm:w-44" aria-label={t("sales.history.status")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("sales.allStatuses")}</SelectItem>
                <SelectItem value="completed">{t("sales.status.completed")}</SelectItem>
                <SelectItem value="voided">{t("sales.status.voided")}</SelectItem>
              </SelectContent>
            </Select>

            {hasHistoryFilters && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={clearHistoryFilters}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t("common.reset")}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 items-end gap-2 border-t border-border/50 pt-3 sm:flex sm:flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="sales-history-from" className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.from")}</Label>
              <Input
                id="sales-history-from"
                type="date"
                value={historyDateFrom}
                onChange={(event) => { setHistoryDateFrom(event.target.value); setHistoryPeriod("custom"); setHistoryPage(1); }}
                className="w-full rounded-xl sm:w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sales-history-to" className="text-xs uppercase tracking-wide text-muted-foreground">{t("common.to")}</Label>
              <Input
                id="sales-history-to"
                type="date"
                value={historyDateTo}
                onChange={(event) => { setHistoryDateTo(event.target.value); setHistoryPeriod("custom"); setHistoryPage(1); }}
                className="w-full rounded-xl sm:w-44"
              />
            </div>
            <div className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground sm:ms-auto" aria-live="polite">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              <span>{format(t("sales.found"), { count: historyItems?.total ?? 0 })}</span>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : !historyItems || historyItems.items.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <ReceiptText className="h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{t("sales.empty")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{hasHistoryFilters ? t("sales.emptyFiltered") : t("sales.emptyHint")}</p>
          </div>
          {hasHistoryFilters && <Button variant="outline" size="sm" onClick={clearHistoryFilters}>{t("common.clearFilters")}</Button>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groupedByDay.map(([dayKey, { usd, cdf }]) => {
            const dayLabel = dayKey === "unknown"
              ? t("sales.unknownDate")
              : new Date(`${dayKey}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
            const showBothCurrencies = historyCurrency === "" && usd.length > 0 && cdf.length > 0;

            return (
              <section key={dayKey} className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm" aria-label={dayLabel}>
                <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-sm">
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <h3 className="truncate text-sm font-semibold">{dayLabel}</h3>
                  </div>
                  <Badge variant="secondary" className="shrink-0">{salesCount(usd.length + cdf.length)}</Badge>
                </div>

                {usd.length > 0 && (
                  <>
                    {showBothCurrencies && (
                      <div className="flex items-center gap-2 border-b border-border/40 bg-emerald-500/5 px-4 py-2">
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">$ USD</span>
                        <span className="text-xs text-muted-foreground">{salesCount(usd.length)}</span>
                      </div>
                    )}
                    <ul className="divide-y divide-border/40">{usd.map(renderSaleRow)}</ul>
                  </>
                )}

                {cdf.length > 0 && (
                  <>
                    {showBothCurrencies && (
                      <div className="flex items-center gap-2 border-y border-border/40 bg-blue-500/5 px-4 py-2">
                        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">FC CDF</span>
                        <span className="text-xs text-muted-foreground">{salesCount(cdf.length)}</span>
                      </div>
                    )}
                    <ul className="divide-y divide-border/40">{cdf.map(renderSaleRow)}</ul>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      {historyItems && historyItems.total > PAGE_SIZE && (
        <nav className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground" aria-label={t("common.pagination")}>
          <span>{format(t("sales.totalSales"), { count: historyItems.total })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => page - 1)} aria-label={t("common.previous")}>
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
            <span>{format(t("common.pageOf"), { page: historyPage, total: totalHistoryPages })}</span>
            <Button variant="outline" size="icon" disabled={historyPage >= totalHistoryPages} onClick={() => setHistoryPage((page) => page + 1)} aria-label={t("common.next")}>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
